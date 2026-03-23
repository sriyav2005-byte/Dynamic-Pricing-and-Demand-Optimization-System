import numpy as np
import pandas as pd

def find_optimal_profit_price(model, base_price, cost):

    prices = np.linspace(base_price * 0.5, base_price * 1.5, 20)

    best_price = base_price
    max_profit = 0

    for p in prices:

        input_df = pd.DataFrame({
            "Price": [p],
            "Revenue": [p * 10]
        })

        demand = model.predict(input_df)[0]

        profit = (p - cost) * demand

        if profit > max_profit:
            max_profit = profit
            best_price = p

    return round(best_price, 2), round(max_profit, 2)