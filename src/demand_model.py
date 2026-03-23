import pandas as pd
import pickle

from sklearn.model_selection import train_test_split
from sklearn.ensemble import RandomForestRegressor
from sklearn.metrics import mean_squared_error, mean_absolute_error, r2_score


def train_model():
    # Load data
    data = pd.read_csv("data/online_retail.csv")

    # ⚠️ CHANGE THESE COLUMNS BASED ON YOUR DATA
    data = data.dropna()

    # Example feature selection (edit if needed)
    X = data[['UnitPrice', 'Quantity']]
    y = data['Quantity']   # or demand column if exists

    # Split
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    # Model
    model = RandomForestRegressor(n_estimators=100, random_state=42)

    # Train
    model.fit(X_train, y_train)

    # Predict
    y_pred = model.predict(X_test)

    # Evaluation
    rmse = mean_squared_error(y_test, y_pred, squared=False)
    mae = mean_absolute_error(y_test, y_pred)
    r2 = r2_score(y_test, y_pred)

    print("\n📊 Model Performance:")
    print("RMSE:", rmse)
    print("MAE:", mae)
    print("R2 Score:", r2)

    # Save model
    with open("models/demand_model.pkl", "wb") as f:
        pickle.dump(model, f)

    return model


def predict_new(model):
    # Example new sample
    new_data = pd.DataFrame({
        'UnitPrice': [20],
        'Quantity': [5]
    })

    prediction = model.predict(new_data)

    print("\n🧪 New Sample Prediction:", prediction[0])