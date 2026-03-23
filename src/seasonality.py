def get_season(month):

    if month in [11,12]:
        return "High Demand Season (Festival)"

    elif month in [6,7]:
        return "Moderate Demand"

    else:
        return "Normal Demand"