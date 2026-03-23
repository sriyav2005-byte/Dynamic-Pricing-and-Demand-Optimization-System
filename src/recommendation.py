def get_recommendation(elasticity, current_price, optimized_price):

    if elasticity > 1:
        return "Demand is sensitive → Consider lowering price"

    elif elasticity < 1:
        return "Demand is stable → You can increase price"

    else:
        return "Balanced demand → Keep price same"