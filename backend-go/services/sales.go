package services

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"

	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/repositories"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

// RecordSale stores a sale, decrements stock atomically and feeds the
// observed reward back to the pricing bandit (closed-loop learning).
func (s *Service) RecordSale(ctx context.Context, id database.Identity, storeID string, in models.SaleInput) (models.Sale, error) {
	sale := models.Sale{ID: uuid.NewString(), StoreID: storeID, ProductID: in.ProductID, Quantity: in.Quantity,
		RecommendationID: in.RecommendationID, Source: in.Source}
	if sale.Source == "" {
		sale.Source = "MANUAL"
	}
	sale.SoldAt = time.Now()
	if in.SoldAt != nil {
		if in.SoldAt.After(time.Now().Add(5 * time.Minute)) {
			return sale, utils.Unprocessable("Invalid sale", map[string]string{"sold_at": "cannot be in the future"})
		}
		sale.SoldAt = *in.SoldAt
	}
	var mrp float64
	err := s.userTx(ctx, id, "", func(tx pgx.Tx) error {
		p, err := repositories.GetProductForUpdate(ctx, tx, storeID, in.ProductID)
		if err != nil {
			return err
		}
		sale.ProductName, mrp = p.Name, p.MRP
		sale.UnitCost = p.CostPrice
		sale.UnitPrice = p.SellingPrice
		if in.UnitPrice != nil {
			sale.UnitPrice = utils.Round2(*in.UnitPrice)
		}
		errs := map[string]string{}
		if sale.UnitPrice > p.MRP {
			errs["unit_price"] = fmt.Sprintf("cannot exceed MRP (₹%.2f)", p.MRP)
		}
		if in.Quantity > p.Stock {
			errs["quantity"] = fmt.Sprintf("exceeds available stock (%d)", p.Stock)
		}
		if len(errs) > 0 {
			return utils.Unprocessable("Invalid sale", errs)
		}
		if in.RecommendationID != nil {
			var ok bool
			if err := tx.QueryRow(ctx, "select exists(select 1 from pricing_recommendations where id=$1 and product_id=$2)",
				*in.RecommendationID, in.ProductID).Scan(&ok); err != nil {
				return err
			}
			if !ok {
				return utils.Unprocessable("Invalid sale", map[string]string{"recommendation_id": "does not belong to this product"})
			}
		}
		if err := repositories.InsertSale(ctx, tx, sale, id.UserID); err != nil {
			return err
		}
		if err := database.SetLocal(ctx, tx, "app.stock_reason", "SALE"); err != nil {
			return err
		}
		if err := database.SetLocal(ctx, tx, "app.stock_ref", sale.ID); err != nil {
			return err
		}
		_, err = repositories.AdjustStock(ctx, tx, storeID, in.ProductID, -in.Quantity)
		return err
	})
	if database.IsNotFound(err) {
		return sale, utils.NotFound("Product")
	}
	if err != nil {
		return sale, err
	}
	sale.Revenue = utils.Round2(float64(sale.Quantity) * sale.UnitPrice)
	sale.Profit = utils.Round2(float64(sale.Quantity) * (sale.UnitPrice - sale.UnitCost))
	s.invalidate(ctx, storeID)
	go s.banditFeedback(sale, mrp)
	return sale, nil
}

// banditFeedback informs the AI service asynchronously; failures are logged
// and never affect the recorded sale.
func (s *Service) banditFeedback(sale models.Sale, mrp float64) {
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	err := s.AI.Post(ctx, "/v1/pricing/feedback", map[string]any{
		"store_id": sale.StoreID, "product_id": sale.ProductID, "price": sale.UnitPrice, "quantity": sale.Quantity,
		"unit_cost": sale.UnitCost, "mrp": mrp, "recommendation_id": sale.RecommendationID,
		"sold_at": sale.SoldAt.Format(time.RFC3339),
	}, nil, "")
	if err != nil {
		slog.Warn("bandit feedback failed", "product", sale.ProductID, "err", err)
	}
}

func (s *Service) ListSales(ctx context.Context, id database.Identity, storeID, productID string, from, to time.Time, limit, offset int) (models.Page[models.Sale], error) {
	var page models.Page[models.Sale]
	err := s.DB.WithUser(ctx, id, func(tx pgx.Tx) error {
		var err error
		page.Data, page.Total, err = repositories.ListSales(ctx, tx, storeID, productID, from, to, limit, offset)
		return err
	})
	return page, err
}
