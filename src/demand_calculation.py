import pandas as pd

def calculate_demand(df):

    demand_data = df.groupby("StockCode").agg({
        "Quantity": "sum",
        "UnitPrice": "mean",
        "Revenue": "sum"
    }).reset_index()

    demand_data.rename(columns={
        "Quantity": "Quantity",
        "UnitPrice": "UnitPrice"
    }, inplace=True)

    return demand_data