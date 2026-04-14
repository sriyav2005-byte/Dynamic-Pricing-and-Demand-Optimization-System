import sys
import os
sys.path.append(os.path.dirname(os.path.dirname(__file__)))

import tkinter as tk
from tkinter import messagebox, ttk
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
# THEME COLORS
# =========================
BG_DARK       = "#0D1117"
BG_CARD       = "#161B22"
BG_INPUT      = "#21262D"
BORDER        = "#30363D"
ACCENT_BLUE   = "#388BFD"
ACCENT_GREEN  = "#3FB950"
ACCENT_YELLOW = "#D29922"
ACCENT_RED    = "#F85149"
TEXT_PRIMARY  = "#E6EDF3"
TEXT_MUTED    = "#8B949E"
BTN_PRIMARY   = "#238636"
BTN_PRIMARY_H = "#2EA043"
BTN_SECONDARY = "#21262D"
BTN_SECONDARY_H = "#30363D"

# =========================
# ROOT WINDOW
# =========================
window = tk.Tk()
window.title("AI Dynamic Pricing Dashboard")
window.geometry("580x720")
window.configure(bg=BG_DARK)
window.resizable(False, False)

# Center the window
window.eval('tk::PlaceWindow . center')

# =========================
# FONTS
# =========================
FONT_TITLE   = ("Courier New", 18, "bold")
FONT_LABEL   = ("Courier New", 10, "bold")
FONT_BODY    = ("Courier New", 10)
FONT_SMALL   = ("Courier New", 9)
FONT_RESULT  = ("Courier New", 10)
FONT_MONO    = ("Courier New", 11, "bold")

# =========================
# HELPERS
# =========================
def make_card(parent, pady=(8, 8)):
    frame = tk.Frame(parent, bg=BG_CARD, relief="flat", bd=0,
                     highlightthickness=1, highlightbackground=BORDER)
    frame.pack(fill="x", padx=24, pady=pady)
    return frame

def make_label(parent, text, font=None, color=TEXT_PRIMARY, anchor="w", padx=16, pady=6):
    lbl = tk.Label(parent, text=text, bg=parent["bg"], fg=color,
                   font=font or FONT_LABEL, anchor=anchor)
    lbl.pack(fill="x", padx=padx, pady=pady)
    return lbl

def make_divider(parent):
    div = tk.Frame(parent, bg=BORDER, height=1)
    div.pack(fill="x", padx=24, pady=4)

# =========================
# HEADER
# =========================
header = tk.Frame(window, bg=BG_DARK)
header.pack(fill="x", padx=24, pady=(22, 4))

tk.Label(
    header,
    text="⬡  DYNAMIC PRICING",
    font=FONT_TITLE,
    bg=BG_DARK,
    fg=TEXT_PRIMARY,
    anchor="w"
).pack(side="left")

tk.Label(
    header,
    text="AI ENGINE",
    font=("Courier New", 10, "bold"),
    bg=BG_DARK,
    fg=ACCENT_BLUE,
    anchor="e"
).pack(side="right", padx=(0, 2), pady=(8, 0))

make_divider(window)

# Subtitle
tk.Label(
    window,
    text="Predict demand · Optimize revenue · Maximize profit",
    font=FONT_SMALL,
    bg=BG_DARK,
    fg=TEXT_MUTED
).pack(pady=(0, 12))

# =========================
# CARD 1 — PRODUCT SELECT
# =========================
card1 = make_card(window)
make_label(card1, "▸  SELECT PRODUCT", color=TEXT_MUTED, font=("Courier New", 9, "bold"))

product_var = tk.StringVar()
product_var.set(products[0])

style = ttk.Style()
style.theme_use("clam")
style.configure(
    "Dark.TCombobox",
    fieldbackground=BG_INPUT,
    background=BG_INPUT,
    foreground=TEXT_PRIMARY,
    selectbackground=ACCENT_BLUE,
    selectforeground=TEXT_PRIMARY,
    arrowcolor=TEXT_MUTED,
    bordercolor=BORDER,
    lightcolor=BORDER,
    darkcolor=BORDER,
    padding=6
)
style.map("Dark.TCombobox",
    fieldbackground=[("readonly", BG_INPUT)],
    foreground=[("readonly", TEXT_PRIMARY)],
    background=[("readonly", BG_INPUT)],
)

product_combo = ttk.Combobox(
    card1,
    textvariable=product_var,
    values=list(products[:50]),
    state="readonly",
    font=FONT_BODY,
    style="Dark.TCombobox"
)
product_combo.pack(fill="x", padx=14, pady=(0, 12))

# =========================
# CARD 2 — CUSTOM PRICE
# =========================
card2 = make_card(window)
make_label(card2, "▸  CUSTOM PRICE OVERRIDE  (optional)", color=TEXT_MUTED, font=("Courier New", 9, "bold"))

price_frame = tk.Frame(card2, bg=BG_CARD)
price_frame.pack(fill="x", padx=14, pady=(0, 12))

prefix = tk.Label(price_frame, text="£", bg=BG_INPUT, fg=ACCENT_YELLOW,
                  font=("Courier New", 12, "bold"), padx=8, pady=6, relief="flat")
prefix.pack(side="left")

price_entry = tk.Entry(
    price_frame,
    font=FONT_MONO,
    bg=BG_INPUT,
    fg=TEXT_PRIMARY,
    insertbackground=ACCENT_BLUE,
    relief="flat",
    bd=0,
    highlightthickness=0
)
price_entry.pack(side="left", fill="x", expand=True, ipady=6)

# Bottom border line under price entry
tk.Frame(card2, bg=BORDER, height=1).pack(fill="x", padx=14)

# =========================
# RESULT DISPLAY
# =========================
result_card = make_card(window, pady=(8, 0))
result_card.configure(highlightbackground=BG_CARD)

result_inner = tk.Frame(result_card, bg=BG_CARD)
result_inner.pack(fill="x", padx=14, pady=10)

# Placeholder rows (will be updated dynamically)
result_rows = {}

METRICS = [
    ("product",      "📦  Product",               TEXT_PRIMARY),
    ("demand",       "📊  Predicted Demand",       ACCENT_BLUE),
    ("opt_price",    "💰  Optimised Price",        ACCENT_GREEN),
    ("rev_price",    "📈  Best Price (Revenue)",   ACCENT_BLUE),
    ("max_rev",      "💵  Max Revenue",            ACCENT_GREEN),
    ("prof_price",   "📊  Best Price (Profit)",    ACCENT_BLUE),
    ("max_profit",   "💹  Max Profit",             ACCENT_GREEN),
    ("rec",          "🧠  Recommendation",         ACCENT_YELLOW),
    ("season",       "🌦  Season",                 TEXT_PRIMARY),
    ("alert",        "🚨  Alert",                  ACCENT_RED),
]

for key, label_text, val_color in METRICS:
    row = tk.Frame(result_inner, bg=BG_CARD)
    row.pack(fill="x", pady=3)

    lbl = tk.Label(row, text=label_text, font=FONT_SMALL, bg=BG_CARD,
                   fg=TEXT_MUTED, width=28, anchor="w")
    lbl.pack(side="left")

    val = tk.Label(row, text="—", font=FONT_RESULT, bg=BG_CARD,
                   fg=val_color, anchor="w")
    val.pack(side="left", fill="x", expand=True)

    result_rows[key] = val

# Initially hide result card
result_card.pack_forget()

# =========================
# STATUS BAR
# =========================
status_var = tk.StringVar(value="Ready.")
status_bar = tk.Label(
    window,
    textvariable=status_var,
    font=FONT_SMALL,
    bg=BG_DARK,
    fg=TEXT_MUTED,
    anchor="w"
)
status_bar.pack(fill="x", padx=28, pady=(6, 0))

# =========================
# BUTTONS
# =========================
btn_frame = tk.Frame(window, bg=BG_DARK)
btn_frame.pack(fill="x", padx=24, pady=(10, 18))

def on_enter_primary(e):   predict_button.configure(bg=BTN_PRIMARY_H)
def on_leave_primary(e):   predict_button.configure(bg=BTN_PRIMARY)
def on_enter_secondary(e): graph_button.configure(bg=BTN_SECONDARY_H)
def on_leave_secondary(e): graph_button.configure(bg=BTN_SECONDARY)

predict_button = tk.Button(
    btn_frame,
    text="⚡  Optimise Price",
    command=lambda: predict_price(),
    bg=BTN_PRIMARY,
    fg=TEXT_PRIMARY,
    font=("Courier New", 11, "bold"),
    relief="flat",
    bd=0,
    padx=20,
    pady=10,
    cursor="hand2",
    activebackground=BTN_PRIMARY_H,
    activeforeground=TEXT_PRIMARY,
)
predict_button.pack(side="left", expand=True, fill="x", padx=(0, 6))
predict_button.bind("<Enter>", on_enter_primary)
predict_button.bind("<Leave>", on_leave_primary)

graph_button = tk.Button(
    btn_frame,
    text="📈  Price vs Demand",
    command=lambda: plot_price_vs_demand(df),
    bg=BTN_SECONDARY,
    fg=TEXT_PRIMARY,
    font=("Courier New", 11, "bold"),
    relief="flat",
    bd=0,
    padx=20,
    pady=10,
    cursor="hand2",
    activebackground=BTN_SECONDARY_H,
    activeforeground=TEXT_PRIMARY,
    highlightthickness=1,
    highlightbackground=BORDER,
)
graph_button.pack(side="left", expand=True, fill="x", padx=(6, 0))
graph_button.bind("<Enter>", on_enter_secondary)
graph_button.bind("<Leave>", on_leave_secondary)

# =========================
# PREDICT FUNCTION
# =========================
def predict_price():
    status_var.set("⏳  Running optimisation...")
    window.update_idletasks()

    selected_product = product_var.get()
    product_data = df[df["StockCode"] == selected_product]

    if price_entry.get().strip():
        try:
            price = float(price_entry.get().strip())
        except ValueError:
            messagebox.showerror("Invalid Input", "Please enter a valid numeric price.")
            status_var.set("❌  Invalid price entered.")
            return
    else:
        price = product_data["UnitPrice"].mean()

    sample_input = pd.DataFrame({
        "UnitPrice": [price],
        "Quantity": [1]
    })

    try:
        predicted_demand = model.predict(sample_input)[0]
    except Exception as e:
        messagebox.showerror("Prediction Error", f"Prediction failed:\n{e}")
        status_var.set("❌  Prediction failed.")
        return

    elasticity    = 0.5
    optimized_price = dynamic_price(price, predicted_demand, elasticity)
    best_price, max_revenue = find_optimal_price(model, price)
    cost          = price * 0.6
    best_profit_price, max_profit = find_optimal_profit_price(model, price, cost)
    recommendation = get_recommendation(elasticity, price, optimized_price)
    month         = pd.Timestamp.now().month
    season        = get_season(month)
    alert         = demand_alert(predicted_demand)

    # Update result rows
    result_rows["product"].config(text=str(selected_product))
    result_rows["demand"].config(text=f"{round(predicted_demand, 2)}")
    result_rows["opt_price"].config(text=f"£ {round(optimized_price, 2)}")
    result_rows["rev_price"].config(text=f"£ {round(best_price, 2)}")
    result_rows["max_rev"].config(text=f"£ {round(max_revenue, 2)}")
    result_rows["prof_price"].config(text=f"£ {round(best_profit_price, 2)}")
    result_rows["max_profit"].config(text=f"£ {round(max_profit, 2)}")
    result_rows["rec"].config(text=recommendation)
    result_rows["season"].config(text=season)
    result_rows["alert"].config(text=alert)

    result_card.pack(fill="x", padx=24, pady=(0, 8))
    status_var.set(f"✅  Optimisation complete for product {selected_product}.")

# =========================
# RUN APP
# =========================
window.mainloop()