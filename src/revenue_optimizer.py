import numpy as np

def find_optimal_price(model, base_price):

    prices = np.linspace(base_price*0.5, base_price*1.5, 20)

    best_price = base_price
    max_revenue = 0

    for p in prices:

        demand = model.predict([[p, p*10]])[0]

        revenue = p * demand

        if revenue > max_revenue:
            max_revenue = revenue
            best_price = p

    return round(best_price,2), round(max_revenue,2)