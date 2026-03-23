import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

import tkinter as tk
from tkinter import messagebox
import pandas as pd
import joblib

from src.dynamic_pricing import dynamic_price
from src.revenue_optimizer import find_optimal_price
from src.visualization import plot_price_vs_demand
from src.recommendation import get_recommendation
from src.seasonality import get_season
from src.alerts import demand_alert
from src.profit_optimizer import find_optimal_profit_price

# =========================
# LOAD MODEL
# =========================
try:
    model = joblib.load("models/demand_model.pkl")
except:
    raise Exception("❌ Model not found. Run training first.")

# =========================
# LOAD DATA
# =========================
df = pd.read_csv("data/online_retail.csv", encoding="latin1")
products = df["StockCode"].unique()

# =========================
# UI SETUP
# =========================
window = tk.Tk()
window.title("AI Dynamic Pricing Dashboard")
window.geometry("520x600")

title = tk.Label(window, text="Dynamic Pricing Dashboard", font=("Arial", 16, "bold"))
title.pack(pady=15)

# -------- PRODUCT DROPDOWN --------
tk.Label(window, text="Select Product").pack()

product_var = tk.StringVar()
product_var.set(products[0])

product_dropdown = tk.OptionMenu(window, product_var, *products[:50])
product_dropdown.pack(pady=5)

# -------- PRICE INPUT --------
tk.Label(window, text="OR Enter Custom Price").pack()

price_entry = tk.Entry(window)
price_entry.pack(pady=5)

# -------- RESULT --------
result_label = tk.Label(window, text="", justify="left", font=("Arial", 10))
result_label.pack(pady=15)

# =========================
# FUNCTION
# =========================
def predict_price():

    selected_product = product_var.get()
    product_data = df[df["StockCode"] == selected_product]

    # ---------- INPUT VALIDATION ----------
    if price_entry.get():
        try:
            price = float(price_entry.get())
        except:
            messagebox.showerror("Error", "Invalid price entered")
            return
    else:
        price = product_data["UnitPrice"].mean()

    # ---------- ML INPUT (FIXED) ----------
    sample_input = pd.DataFrame({
        "UnitPrice": [price]
    })

    try:
        predicted_demand = model.predict(sample_input)[0]
    except Exception as e:
        messagebox.showerror("Error", f"Prediction failed:\n{e}")
        return

    # ---------- PRICING ----------
    elasticity = 0.5  # assumed (you can improve later)

    optimized_price = dynamic_price(price, predicted_demand, elasticity)

    # Revenue optimization
    best_price, max_revenue = find_optimal_price(model, price)

    # Profit optimization
    cost = price * 0.6
    best_profit_price, max_profit = find_optimal_profit_price(model, price, cost)

    # Recommendation
    recommendation = get_recommendation(elasticity, price, optimized_price)

    # Season
    month = pd.Timestamp.now().month
    season = get_season(month)

    # Alert
    alert = demand_alert(predicted_demand)

    # ---------- DISPLAY ----------
    result_label.config(
        text=f"""
📦 Product: {selected_product}

📊 Predicted Demand: {round(predicted_demand, 2)}
💰 Optimized Price: {round(optimized_price, 2)}

📈 Best Price (Revenue): {round(best_price, 2)}
💵 Max Revenue: {round(max_revenue, 2)}

📊 Best Price (Profit): {round(best_profit_price, 2)}
💹 Max Profit: {round(max_profit, 2)}

🧠 Recommendation: {recommendation}
🌦 Season: {season}
🚨 Alert: {alert}
"""
    )

# =========================
# BUTTONS
# =========================
predict_button = tk.Button(
    window,
    text="Optimize Price",
    command=predict_price,
    bg="blue",
    fg="white",
    width=20
)
predict_button.pack(pady=10)

graph_button = tk.Button(
    window,
    text="Show Price vs Demand Graph",
    command=lambda: plot_price_vs_demand(df),
    width=25
)
graph_button.pack(pady=10)

# =========================
# RUN APP
# =========================
window.mainloop()