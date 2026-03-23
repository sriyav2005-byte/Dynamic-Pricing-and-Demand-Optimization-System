import pandas as pd
import pickle

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score

from src.data_cleaning import load_and_clean_data
from src.price_elasticity import calculate_elasticity
from src.dynamic_pricing import dynamic_price
from src.visualization import plot_price_vs_demand
from src.visualization import plot_elasticity_distribution
from src.visualization import revenue_simulation


# =========================
# STEP 1: LOAD DATA
# =========================
df = load_and_clean_data()

# =========================
# STEP 2: ML MODEL TRAINING
# =========================
print("\n🚀 Training Demand Prediction Model...")

df = df.dropna()

# Features & target
X = df[['UnitPrice']]
y = df['Quantity']   # treating Quantity as demand

# Train-test split
X_train, X_test, y_train, y_test = train_test_split(
    X, y, test_size=0.2, random_state=42
)

# Model
model = RandomForestRegressor(n_estimators=100, random_state=42)
model.fit(X_train, y_train)

# Predictions
y_pred = model.predict(X_test)

# =========================
# STEP 3: EVALUATION
# =========================
rmse = mean_squared_error(y_test, y_pred, squared=False)
mae = mean_absolute_error(y_test, y_pred)
r2 = r2_score(y_test, y_pred)

print("\n📊 Model Performance:")
print("RMSE:", rmse)
print("MAE:", mae)
print("R2 Score:", r2)

# Save model
with open("models/demand_model.pkl", "wb") as f:
    pickle.dump(model, f)

# =========================
# STEP 4: NEW SAMPLE TEST
# =========================
new_sample = pd.DataFrame({
    'UnitPrice': [50]
})

predicted_demand = model.predict(new_sample)
print("\n🧪 Predicted Demand for New Price:", predicted_demand[0])


# =========================
# STEP 5: YOUR ORIGINAL LOGIC
# =========================
print("\n⚙️ Running Dynamic Pricing Pipeline...")

grouped = df.groupby("StockCode")
results = []

for product, product_data in grouped:

    avg_price = product_data["UnitPrice"].mean()

    # 🔥 Use ML prediction instead of raw sum
    predicted_demand = model.predict(
        pd.DataFrame({'UnitPrice': [avg_price]})
    )[0]

    elasticity = calculate_elasticity(product_data)

    new_price = dynamic_price(avg_price, predicted_demand, elasticity)

    results.append({
        "Product": product,
        "AvgPrice": avg_price,
        "PredictedDemand": predicted_demand,
        "Elasticity": elasticity,
        "OptimizedPrice": new_price
    })

results_df = pd.DataFrame(results)

print("\n📈 Optimized Pricing Results:")
print(results_df.head(10))

# Save results
results_df.to_csv("optimized_prices.csv", index=False)

# =========================
# STEP 6: VISUALIZATION
# =========================
plot_price_vs_demand(df)
plot_elasticity_distribution(results_df)
revenue_simulation(10, 200)