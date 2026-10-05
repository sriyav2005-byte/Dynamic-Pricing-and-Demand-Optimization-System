package middleware

import (
	"context"
	"time"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"

	"github.com/rishabh26raj/priceiq/backend-go/clients"
	"github.com/rishabh26raj/priceiq/backend-go/database"
	"github.com/rishabh26raj/priceiq/backend-go/models"
	"github.com/rishabh26raj/priceiq/backend-go/utils"
)

const (
	ctxStoreID   = "priceiq.store_id"
	ctxStoreRole = "priceiq.store_role"
	roleCacheTTL = 60 * time.Second
)

// RoleResolver looks up the caller's effective role on a store.
type RoleResolver struct {
	DB    *database.DB
	Cache clients.Cache
}

// StoreRole returns the highest role the user holds on the store ("" if none).
// Super admins receive SUPER_ADMIN on every store.
func (r *RoleResolver) StoreRole(ctx context.Context, userID, storeID string) (models.Role, error) {
	key := "role:" + userID + ":" + storeID
	if b, err := r.Cache.Get(ctx, key); err == nil {
		return models.Role(b), nil
	}
	var role *string
	err := r.DB.Pool.QueryRow(ctx, `
		select case when coalesce((select is_super_admin from profiles where id = $1), false)
		            then 'SUPER_ADMIN'
		            else (select max(m.role)::text
		                  from memberships m join stores s on s.organization_id = m.organization_id
		                  where s.id = $2 and m.user_id = $1 and (m.store_id is null or m.store_id = s.id)) end`,
		userID, storeID).Scan(&role)
	if err != nil {
		return "", err
	}
	out := models.Role("")
	if role != nil {
		out = models.Role(*role)
	}
	_ = r.Cache.Set(ctx, key, []byte(out), roleCacheTTL)
	return out, nil
}

// InvalidateUser drops cached roles for a user (after membership changes).
func (r *RoleResolver) InvalidateUser(ctx context.Context, userID string) {
	_ = r.Cache.Delete(ctx, "role:"+userID+":*")
}

// RequireStore authorizes access to the :store_id path parameter with at
// least the given role. Unknown stores and stores the caller has no access
// to both yield 404 so store ids cannot be probed. RLS re-checks every query.
func (r *RoleResolver) RequireStore(min models.Role) gin.HandlerFunc {
	return func(c *gin.Context) {
		storeID := c.Param("store_id")
		if _, err := uuid.Parse(storeID); err != nil {
			utils.Respond(c, utils.BadRequest("store_id must be a UUID"))
			return
		}
		role, err := r.StoreRole(c.Request.Context(), Identity(c).UserID, storeID)
		if err != nil {
			utils.Respond(c, err)
			return
		}
		if role == "" {
			utils.Respond(c, utils.NotFound("Store"))
			return
		}
		if !role.AtLeast(min) {
			utils.Respond(c, utils.Forbidden("This action requires the "+string(min)+" role or higher"))
			return
		}
		c.Set(ctxStoreID, storeID)
		c.Set(ctxStoreRole, role)
		c.Next()
	}
}

// MinRole is a per-route guard used after RequireStore(VIEWER).
func MinRole(min models.Role) gin.HandlerFunc {
	return func(c *gin.Context) {
		if !StoreRole(c).AtLeast(min) {
			utils.Respond(c, utils.Forbidden("This action requires the "+string(min)+" role or higher"))
			return
		}
		c.Next()
	}
}

func StoreID(c *gin.Context) string { return c.GetString(ctxStoreID) }

func StoreRole(c *gin.Context) models.Role {
	v, _ := c.Get(ctxStoreRole)
	r, _ := v.(models.Role)
	return r
}
