# Roles, access and operations

## Roles
- VIEWER — read access to the store's data.
- ANALYST — can also generate price recommendations and simulations, run alert scans, acknowledge alerts and export reports.
- STORE_MANAGER — can also edit products, import products, adjust stock, record sales, approve / reject / apply prices and record competitor prices.
- ADMIN — can also change store settings (pricing mode, margins, rules), edit stores and manage organization members.
- SUPER_ADMIN — platform operator.
A role granted without a store applies to every store in the organization.
Users only ever see data of stores they are members of; this is enforced by both the API and PostgreSQL row-level security.

## Audit log
Product, price, stock, settings, membership and recommendation changes are recorded with the user, the old and new values, the time and the reason.
Store managers and admins can view the audit log.

## Product data rules
SKU is required and unique per store (case-insensitive). Barcodes are unique per store and GTIN/EAN check digits are validated.
Prices must be positive, the selling price cannot exceed MRP, cost cannot exceed MRP, stock cannot be negative and expiry dates cannot be in the past.
Bulk import accepts CSV or Excel with the columns of the downloadable template; by default the whole file is rejected if any row is invalid, and a dry run reports errors without saving.

## Recording sales
Recording a sale reduces stock atomically and feeds the realized profit back to the pricing bandit (closed-loop learning). A sale larger than available stock or above MRP is rejected.
