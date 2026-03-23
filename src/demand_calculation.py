import pandas as pd

def calculate_demand(df):

    demand_data = df.groupby("StockCode").agg({
        "Quantity": "sum",
        "UnitPrice": "mean",
        "Revenue": "sum"
    }).reset_index()

    demand_data.rename(columns={
        "Quantity": "Demand",
        "UnitPrice": "Price"
    }, inplace=True)

    return demand_data