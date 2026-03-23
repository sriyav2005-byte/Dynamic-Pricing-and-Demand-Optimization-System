def dynamic_price(price, predicted_demand, elasticity):

    if elasticity > 1:
        # demand sensitive → lower price
        new_price = price * 0.9

    elif elasticity < 1:
        # demand not sensitive → increase price
        new_price = price * 1.1

    else:
        new_price = price

    return round(new_price, 2)