# PriceIQ pricing policy and constraints

## Margin convention
PriceIQ measures margin as gross margin on the selling price: margin = (price − cost) ÷ price.
A minimum margin of 10% therefore means the price must be at least cost ÷ 0.9.

## Constraints every recommended price must pass
Every price recommended by the AI passes the constraint engine in the Go API before it is stored,
and is checked again at the moment it is applied. The machine-learning model can never bypass these rules.

1. MRP ceiling — a price may never exceed the product's MRP (Maximum Retail Price). This is a legal limit and has the highest priority.
2. Minimum margin — price ≥ cost ÷ (1 − minimum margin). The store default is set in Settings (min_margin_pct) and can be overridden per category with the business rule category_min_margin.
3. Maximum price change — a single update may not move the price by more than max_price_change_pct (default 10%) up or down from the current price.
4. Expiry rules — when a product with stock expires within expiry_markdown_days (default 7 days):
   - the minimum-margin floor is relaxed to break-even (cost price), or to any price if allow_below_cost_clearance is enabled;
   - markdowns up to max_expiry_markdown_pct (default 40%) are allowed in one step;
   - price increases are blocked.
5. Business rules (Settings → rules): round_to (round to a multiple, e.g. ₹0.50 or ₹1), min_price, max_price, category_min_margin and freeze_categories (categories whose prices are never changed).

When rules conflict, priority is MRP > minimum margin > maximum change. A recommendation affected by a conflict is always sent for manager approval.
Each recommendation lists the constraints that changed the model's preferred price (constraints_applied), for example "max_price_change limited the increase from ₹110 to ₹104.50".

## Pricing modes
- MANUAL — the AI recommends; a store manager applies the price.
- SEMI_AUTOMATIC — the AI recommends; a store manager must approve before it can be applied.
- AUTOMATIC — the AI recommends, constraints validate and the system applies low-risk changes itself. A change larger than approval_threshold_pct (default 5%), a recommendation with a rule conflict, or one with confidence below 0.5 still requires manager approval.
Only admins can change the pricing mode.

## Approval workflow
AI recommendation → manager review → approve or reject → apply.
A recommendation becomes EXPIRED if the product's price changed after it was generated; generate a new one.
Newer recommendations for the same product supersede older pending ones (status SUPERSEDED).
Every applied price is written to the price history with the source (MANUAL, RECOMMENDATION, AUTOMATIC, IMPORT), the user and the reason, and to the audit log.
