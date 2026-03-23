import matplotlib.pyplot as plt
import seaborn as sns


def plot_price_vs_demand(df):

    plt.figure(figsize=(8,5))
    sns.scatterplot(x="UnitPrice", y="Quantity", data=df)

    plt.title("Price vs Demand")
    plt.xlabel("Price")
    plt.ylabel("Demand")

    plt.show()


def plot_elasticity_distribution(results_df):

    plt.figure(figsize=(8,5))
    sns.histplot(results_df["Elasticity"], bins=30)

    plt.title("Elasticity Distribution")
    plt.xlabel("Elasticity")
    plt.ylabel("Number of Products")

    plt.show()
def revenue_simulation(price, demand):

    prices = []
    revenues = []

    for p in range(1, 50):

        revenue = p * demand
        prices.append(p)
        revenues.append(revenue)

    plt.figure(figsize=(8,5))
    plt.plot(prices, revenues)

    plt.title("Revenue Optimization")
    plt.xlabel("Price")
    plt.ylabel("Revenue")

    plt.show()