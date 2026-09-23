"""
tests/test_api.py — End-to-End API Integration Tests
=====================================================
Standard library unittest verification of all FastAPI routes.
"""

import unittest
from fastapi.testclient import TestClient
from app.main import app


class TestAPI(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    def test_products_endpoints(self):
        r = self.client.get("/products/")
        self.assertEqual(r.status_code, 200)
        data = r.json()
        self.assertIsInstance(data, list)
        self.assertGreater(len(data), 0)

        p0 = self.client.get("/products/0")
        self.assertEqual(p0.status_code, 200)
        self.assertEqual(p0.json()["product_id"], 0)

    def test_categories_endpoint(self):
        r = self.client.get("/categories")
        self.assertEqual(r.status_code, 200)
        self.assertIsInstance(r.json(), list)

    def test_pricing_endpoints(self):
        rec = self.client.get("/pricing/recommend/0")
        self.assertEqual(rec.status_code, 200)
        data = rec.json()
        self.assertIn("recommended_price", data)
        self.assertIn("price_options", data)
        self.assertEqual(len(data["price_options"]), 10)

        sim = self.client.get("/pricing/simulate/0?price=85.0")
        self.assertEqual(sim.status_code, 200)
        self.assertIn("expected_demand", sim.json())

    def test_analytics_endpoints(self):
        summary = self.client.get("/analytics/summary")
        self.assertEqual(summary.status_code, 200)
        self.assertIn("total_revenue", summary.json())

        trends = self.client.get("/analytics/trends")
        self.assertEqual(trends.status_code, 200)
        self.assertIsInstance(trends.json(), list)
        self.assertGreater(len(trends.json()), 0)

    def test_competitor_endpoints(self):
        p = self.client.get("/competitor/prices/0")
        self.assertEqual(p.status_code, 200)
        self.assertIn("competitors", p.json())

        overview = self.client.get("/competitor/market-overview")
        self.assertEqual(overview.status_code, 200)
        self.assertIsInstance(overview.json(), list)

        strat = self.client.get("/competitor/strategy/0")
        self.assertEqual(strat.status_code, 200)
        self.assertIn("strategy", strat.json())

    def test_inventory_endpoints(self):
        inv = self.client.get("/inventory/overview")
        self.assertEqual(inv.status_code, 200)
        self.assertIn("total_stock_value", inv.json())

        risk = self.client.get("/inventory/expiry-risk")
        self.assertEqual(risk.status_code, 200)

        alerts = self.client.get("/inventory/alerts")
        self.assertEqual(alerts.status_code, 200)

    def test_forecasting_endpoints(self):
        fc = self.client.get("/forecasting/demand/0")
        self.assertEqual(fc.status_code, 200)
        self.assertIn("forecast_points", fc.json())

        fco = self.client.get("/forecasting/overview")
        self.assertEqual(fco.status_code, 200)

    def test_agent_endpoints(self):
        sugg = self.client.get("/agent/suggestions")
        self.assertEqual(sugg.status_code, 200)

        chat = self.client.post("/agent/chat", json={"message": "Which products have high expiry risk?"})
        self.assertEqual(chat.status_code, 200)
        self.assertIn("response_text", chat.json())

    def test_update_sales_and_learning_loop(self):
        r = self.client.post("/update-sales", json={"product_id": 0, "price": 75.0, "units_sold": 5})
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.json()["product_id"], 0)

    def test_search_endpoints(self):
        platforms = self.client.get("/search/platforms")
        self.assertEqual(platforms.status_code, 200)
        self.assertIsInstance(platforms.json(), list)
        self.assertGreater(len(platforms.json()), 0)

        live = self.client.get("/search/live?query=milk")
        self.assertEqual(live.status_code, 200)
        data = live.json()
        self.assertIn("results", data)
        self.assertIn("query", data)


if __name__ == "__main__":
    unittest.main()


