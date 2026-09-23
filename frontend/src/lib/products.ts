/**
 * lib/products.ts — Static Product ID to Name Mapping
 * ====================================================
 * Contains human-readable names for all 50 products (IDs 0–49)
 * matching backend/app/utils/product_names.py.
 */

export const PRODUCT_NAMES: Record<number, string> = {
  0: "Paper Boat Coconut Water",
  1: "Amul Cheese Slices",
  2: "Haldiram's Aloo Bhujia",
  3: "Parle-G Original Glucose Biscuits",
  4: "Frooti Mango Drink",
  5: "Bingo! Mad Angles",
  6: "Tata Salt Iodized Salt",
  7: "Aashirvaad Sugar",
  8: "Fortune Sunflower Oil",
  9: "Britannia Marie Gold Biscuits",
  10: "Tropicana Mixed Fruit Juice",
  11: "Aashirvaad Whole Wheat Atta",
  12: "Parle Monaco Biscuits",
  13: "Tata Sampann Toor Dal",
  14: "India Gate Basmati Rice",
  15: "Haldiram's Bhujia Sev",
  16: "Lay's Classic Salted Potato Chips",
  17: "Kurkure Masala Munch",
  18: "Coca-Cola Soft Drink",
  19: "Britannia NutriChoice Biscuits",
  20: "Amul Taaza Toned Milk",
  21: "Balaji Wafers Simply Salted",
  22: "Haldiram's Moong Dal",
  23: "Real Fruit Power Mixed Fruit",
  24: "Fortune Chakki Fresh Atta",
  25: "Tata Toor Dal",
  26: "Saffola Gold Cooking Oil",
  27: "Haldiram's Khatta Meetha",
  28: "Parle Hide & Seek Biscuits",
  29: "Britannia Bourbon Biscuits",
  30: "Bingo! Tedhe Medhe",
  31: "Amul Butter",
  32: "Amul Paneer",
  33: "Sprite Soft Drink",
  34: "Tata Salt Lite",
  35: "Haldiram's Sev",
  36: "Thums Up Soft Drink",
  37: "Parle KrackJack Biscuits",
  38: "Tata Moong Dal",
  39: "Amul Cheese Block",
  40: "Fortune Chakki Fresh Atta",
  41: "Amul Curd",
  42: "Haldiram's Masala Peanuts",
  43: "Tata Sugar",
  44: "Maaza Mango Drink",
  45: "Tata Besan",
  46: "Britannia Good Day Cashew Cookies",
  47: "Fortune Sunflower Oil",
  48: "India Gate Basmati Rice",
  49: "Amul Taaza Milk",
};

/**
 * Return the friendly product name for a given product ID.
 * Falls back to category title or fallback string or Item #id.
 */
export function getProductName(
  productId: number | string | undefined | null,
  fallback?: string,
  category?: string
): string {
  if (productId === undefined || productId === null) return fallback || "Unknown Product";
  const idNum = Number(productId);
  if (!isNaN(idNum) && PRODUCT_NAMES[idNum]) {
    return PRODUCT_NAMES[idNum];
  }
  if (category) {
    const catTitle = category.charAt(0).toUpperCase() + category.slice(1);
    return `${catTitle} Item #${productId}`;
  }
  return fallback || `Item #${productId}`;
}
