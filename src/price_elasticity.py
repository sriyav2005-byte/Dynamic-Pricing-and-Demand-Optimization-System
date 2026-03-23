import numpy as np

def calculate_elasticity(product_data):

    price = product_data["UnitPrice"].values
    demand = product_data["Quantity"].values

    if len(price) < 2:
        return 0

    price_change = np.diff(price)
    demand_change = np.diff(demand)

    elasticity_values = []

    for i in range(len(price_change)):

        if price_change[i] != 0 and price[i] != 0 and demand[i] != 0:

            e = (demand_change[i] / demand[i]) / (price_change[i] / price[i])
            elasticity_values.append(e)

    if len(elasticity_values) == 0:
        return 0

    return np.mean(elasticity_values)