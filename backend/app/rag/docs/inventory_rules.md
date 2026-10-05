# PriceIQ inventory rules

## Sales velocity
Average daily units are measured over the 28 days before the store's reference date. Days without sales count as zero.
For stores holding the synthetic training dataset (data mode SYNTHETIC) the reference date is the last sale in the dataset; for live stores it is today.

## Statuses
- OUT_OF_STOCK — stock is zero.
- LOW_STOCK — stock is at or below the reorder point, or days of cover are below low_stock_cover_days (default 3).
- PREDICTED_STOCKOUT — days of cover are shorter than the supplier lead time (default 3 days when no supplier is set), so a reorder placed now may arrive too late.
- OVERSTOCK — days of cover exceed overstock_cover_days (default 60).
- DEAD_STOCK — stock on hand but no sale within dead_stock_days (default 30).
- EXPIRY_RISK — units are not expected to sell before the expiry date at the current sales rate.

## Formulas
- Days of cover = stock ÷ average daily units.
- Recommended safety stock = 1.65 × standard deviation of daily units × √(lead time) — a 95% cycle service level. It is only computed with at least 7 selling days in the last 28; otherwise it is reported as unavailable rather than guessed.
- Reorder point = average daily units × lead time + safety stock (a configured reorder level overrides it).
- Recommended reorder quantity = average daily units × (lead time + 7-day review period) + safety stock − stock, when stock is at or below the reorder point.
- Units at expiry risk = stock − expected sales before expiry.
- Inventory valuation is reported at cost and at retail price.

## Expiry optimization
For products expiring within the markdown window, markdown levels from 0% to the store's maximum are evaluated with the demand model over the remaining shelf life.
The recommended markdown maximizes profit net of waste (the cost of units that would expire unsold). The floor is break-even cost unless below-cost clearance is enabled.

## Alerts
Alerts are generated every 15 minutes (or on demand) for low stock, predicted stockout, overstock, dead stock, expiry, competitor undercut, competitor price change, demand spike, demand drop, pricing opportunity and statistical anomalies.
Severities are LOW, MEDIUM, HIGH and CRITICAL. HIGH and CRITICAL alerts notify store managers and admins in the app (and by e-mail when SMTP is configured).
Alerts resolve automatically when their condition clears.
