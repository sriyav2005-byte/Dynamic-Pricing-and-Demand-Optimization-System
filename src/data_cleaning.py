import pandas as pd

def load_and_clean_data():

    df = pd.read_csv("data/online_retail.csv", encoding="latin1")

    # remove missing values
    df = df.dropna()

    # remove negative quantities
    df = df[df["Quantity"] > 0]

    # remove negative price
    df = df[df["UnitPrice"] > 0]

    # convert date
    df["InvoiceDate"] = pd.to_datetime(df["InvoiceDate"], dayfirst=True)

    # create revenue column
    df["Revenue"] = df["Quantity"] * df["UnitPrice"]

    return df