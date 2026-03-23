def demand_alert(demand):

    if demand > 500:
        return "🔥 High Demand – Increase Price"

    elif demand < 100:
        return "⚠️ Low Demand – Offer Discount"

    else:
        return "✅ Stable Demand"