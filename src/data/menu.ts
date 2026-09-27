import type { MenuItem } from "../types";

// The printed cafe menu (Aug 2026 edition), category by category in the
// order of its pages. A dish printed on two pages (e.g. Chilli Potato under
// Starters and Chinese) is listed under both, so either page's category finds it.
//
// Bump MENU_VERSION whenever this list changes: a saved menu from an older
// version is replaced by this one on the next load (Rates edits made to the
// older menu are dropped with it).
export const MENU_VERSION = 3;

export const menu: MenuItem[] = [
  // Starters
  item("peanut-masala", "Peanut Masala", "Starters", 100),
  item("bhel", "Bhel", "Starters", 100),
  item("french-fries", "French Fries", "Starters", 100),
  item("masala-fries", "Masala Fries", "Starters", 120),
  item("starter-spring-roll", "Spring Roll", "Starters", 150),
  item("bread-roll", "Bread Roll", "Starters", 150),
  item("starter-chilli-potato", "Chilli Potato", "Starters", 180),
  item("starter-honey-chilli-potato", "Honey Chilli Potato", "Starters", 200),
  item("crispy-corn", "Crispy Corn", "Starters", 240),
  item("dahi-ke-sholey", "Dahi Ke Sholey", "Starters", 250),
  item("starter-chilli-paneer", "Chilli Paneer", "Starters", 250),
  item("paneer-65", "Paneer 65", "Starters", 250),
  item("paneer-manchurian", "Paneer Manchurian", "Starters", 230),
  item("starter-chilli-mushroom", "Chilli Mushroom", "Starters", 250),
  item("kung-pao-paneer", "Kung Pao Paneer", "Starters", 250),
  item("mushroom-777", "Mushroom 777", "Starters", 250),
  item("starter-chilli-gobi", "Chilli Gobi", "Starters", 250),

  // Non-Veg Starters
  item("chicken-65", "Chicken 65", "Non-Veg Starters", 280),
  item("dragon-chicken", "Dragon Chicken", "Non-Veg Starters", 300),
  item("chicken-777", "Chicken 777", "Non-Veg Starters", 280),
  item("chicken-salt-pepper", "Chicken Salt & Pepper", "Non-Veg Starters", 300),
  item("starter-chilli-chicken", "Chilli Chicken", "Non-Veg Starters", 280),
  item("starter-honey-chilli-chicken", "Honey Chilli Chicken", "Non-Veg Starters", 300),
  item("chicken-hot-garlic", "Chicken Hot Garlic", "Non-Veg Starters", 280),
  item("crispy-chicken", "Crispy Chicken", "Non-Veg Starters", 300),
  item("starter-lemon-chicken", "Lemon Chicken", "Non-Veg Starters", 300),

  // Egg Mania
  item("omelette", "Omelette", "Egg Mania", 100),
  item("bread-omelette", "Bread Omelette", "Egg Mania", 120),
  item("cheese-omelette", "Cheese Omelette", "Egg Mania", 140),
  item("egg-white-omelette", "Egg White Omelette", "Egg Mania", 100),
  item("boiled-eggs", "Boiled Eggs (5 pcs)", "Egg Mania", 100),
  item("chicken-omelette", "Chicken Omelette", "Egg Mania", 150),

  // Maggi
  item("plain-maggi", "Plain Maggi", "Maggi", 100),
  item("veg-masala-maggi", "Veg Masala Maggi", "Maggi", 120),
  item("cheese-maggi", "Cheese Maggi", "Maggi", 130),
  item("egg-maggi", "Egg Maggi", "Maggi", 130),
  item("chicken-maggi", "Chicken Maggi", "Maggi", 150),

  // Healthy Wraps
  item("vegetable-wrap", "Vegetable Wrap", "Healthy Wraps", 150),
  item("egg-wrap", "Egg Wrap", "Healthy Wraps", 190),
  item("chicken-wrap", "Chicken Wrap", "Healthy Wraps", 220),

  // Momos
  item("paneer-steamed-momos", "Paneer Steamed Momos", "Momos", 150),
  item("paneer-fried-momos", "Paneer Fried Momos", "Momos", 180),
  item("kurkure-paneer-momos", "Kurkure Paneer Momos", "Momos", 200),
  item("chilli-paneer-momos", "Chilli Paneer Momos", "Momos", 200),
  item("chicken-steamed-momos", "Chicken Steamed Momos", "Momos", 180),
  item("chicken-fried-momos", "Chicken Fried Momos", "Momos", 200),
  item("kurkure-chicken-momos", "Kurkure Chicken Momos", "Momos", 230),
  item("chilli-chicken-momos", "Chilli Chicken Momos", "Momos", 250),

  // Rolls
  item("veg-roll", "Veg Roll", "Rolls", 120),
  item("spring-roll", "Spring Roll", "Rolls", 150),
  item("chicken-spring-roll", "Chicken Spring Roll", "Rolls", 200),
  item("chowmein-roll", "Chowmein Roll", "Rolls", 130),
  item("paneer-roll", "Paneer Roll", "Rolls", 150),
  item("chilli-paneer-roll", "Chilli Paneer Roll", "Rolls", 160),
  item("double-egg-roll", "Double Egg Roll", "Rolls", 150),
  item("chicken-roll", "Chicken Roll", "Rolls", 180),
  item("chilli-chicken-roll", "Chilli Chicken Roll", "Rolls", 200),
  item("egg-chicken-roll", "Egg Chicken Roll", "Rolls", 220),

  // Sandwiches
  item("veg-grilled-sandwich", "Veg Grilled Sandwich", "Sandwiches", 150),
  item("aloo-grilled-sandwich", "Aloo Grilled Sandwich", "Sandwiches", 150),
  item("cheese-corn-sandwich", "Cheese Corn Sandwich", "Sandwiches", 180),
  item("pizza-sandwich", "Pizza Sandwich", "Sandwiches", 220),
  item("paneer-vegetable-sandwich", "Paneer Vegetable Sandwich", "Sandwiches", 200),
  item("paneer-power-sandwich", "Paneer Power Sandwich", "Sandwiches", 220),
  item("chicken-mayo-sandwich", "Chicken Mayo Sandwich", "Sandwiches", 250),

  // Burgers
  item("crispy-aloo-tikki-burger", "Crispy Aloo Tikki Burger", "Burgers", 100),
  item("veg-burger", "Veg Burger", "Burgers", 120),
  item("cheese-burger", "Cheese Burger", "Burgers", 140),
  item("egg-burger", "Egg Burger", "Burgers", 140),
  item("chicken-burger", "Chicken Burger", "Burgers", 150),
  item("chicken-cheese-burger", "Chicken Cheese Burger", "Burgers", 160),

  // Pizzas
  item("margherita-pizza", "Margherita Pizza", "Pizzas", 150),
  item("onion-pizza", "Onion Pizza", "Pizzas", 170),
  item("golden-corn-pizza", "Golden Corn Pizza", "Pizzas", 170),
  item("veg-loaded-pizza", "Veg Loaded Pizza", "Pizzas", 200),
  item("alpha-special-pizza", "Alpha Special Overloaded Pizza", "Pizzas", 250),
  item("tandoori-paneer-pizza", "Tandoori Paneer Pizza", "Pizzas", 200),
  item("chicken-pizza", "Chicken Pizza", "Pizzas", 220),

  // Pastas
  item("veggies-pasta", "Veggies Pasta", "Pastas", 220),
  item("cheese-pasta", "Cheese Pasta", "Pastas", 250),
  item("arrabiata-pasta", "Arrabiata Red Sauce Pasta", "Pastas", 250),
  item("chicken-arrabiata-pasta", "Chicken Arrabiata Red Sauce Pasta", "Pastas", 300),
  item("alfredo-penne", "Alfredo White Sauce Penne", "Pastas", 250),
  item("chicken-alfredo-penne", "Chicken Alfredo White Sauce Penne", "Pastas", 300),
  item("mixed-sauce-pasta", "Mixed Sauce Pasta", "Pastas", 300),
  item("chicken-mixed-sauce-pasta", "Chicken Mixed Sauce Pasta", "Pastas", 350),

  // Fried Rice
  item("veg-fried-rice", "Veg Fried Rice", "Fried Rice", 180),
  item("veg-singapuri-rice", "Veg Singapuri Fried Rice", "Fried Rice", 200),
  item("chilli-garlic-fried-rice", "Chilli Garlic Fried Rice", "Fried Rice", 200),
  item("egg-fried-rice", "Egg Fried Rice", "Fried Rice", 220),
  item("butter-garlic-fried-rice", "Butter Garlic Fried Rice", "Fried Rice", 250),
  item("chicken-fried-rice", "Chicken Fried Rice", "Fried Rice", 250),
  item("schezwan-fried-rice", "Schezwan Fried Rice", "Fried Rice", 250),
  item("chicken-singapuri-rice", "Chicken Singapuri Fried Rice", "Fried Rice", 250),

  // Chinese
  item("veg-chowmein", "Veg Chowmein", "Chinese", 150),
  item("singapuri-chowmein", "Singapuri Chowmein", "Chinese", 180),
  item("paneer-chowmein", "Paneer Chowmein", "Chinese", 180),
  item("veg-hakka-noodles", "Veg Hakka Noodles", "Chinese", 180),
  item("veg-singapuri-noodles", "Veg Singapuri Noodles", "Chinese", 180),
  item("chilli-garlic-noodles", "Chilli Garlic Noodles", "Chinese", 180),
  item("egg-noodles", "Egg Noodles", "Chinese", 200),
  item("chilli-potato", "Chilli Potato", "Chinese", 180),
  item("honey-chilli-potato", "Honey Chilli Potato", "Chinese", 200),
  item("manchurian-dry", "Manchurian Dry", "Chinese", 200),
  item("manchurian-gravy", "Manchurian Gravy", "Chinese", 220),
  item("chilli-paneer", "Chilli Paneer", "Chinese", 250),
  item("chilli-mushroom", "Chilli Mushroom", "Chinese", 250),
  item("chilli-gobi", "Chilli Gobi", "Chinese", 250),

  // Chinese Non-Veg
  item("chilli-chicken", "Chilli Chicken", "Chinese Non-Veg", 280),
  item("honey-chilli-chicken", "Honey Chilli Chicken", "Chinese Non-Veg", 300),
  item("chicken-lollipop", "Chicken Lollipop", "Chinese Non-Veg", 300),
  item("chicken-manchurian", "Chicken Manchurian", "Chinese Non-Veg", 280),
  item("lemon-chicken", "Lemon Chicken", "Chinese Non-Veg", 300),
  item("american-chopsuey", "American Chopsuey", "Chinese Non-Veg", 300),
  item("chicken-chopsuey", "Chicken Chopsuey", "Chinese Non-Veg", 300),

  // Hot Beverages
  item("tea", "Tea", "Hot Beverages", 30),
  item("black-tea", "Black Tea", "Hot Beverages", 50),
  item("green-tea", "Green Tea", "Hot Beverages", 50),
  item("black-coffee", "Black Coffee", "Hot Beverages", 50),
  item("hot-coffee", "Hot Coffee", "Hot Beverages", 99),
  item("hot-chocolate", "Hot Chocolate", "Hot Beverages", 99),
  item("bournvita-milk", "Bournvita Milk", "Hot Beverages", 80),

  // Shakes
  item("cold-coffee", "Cold Coffee", "Shakes", 120),
  item("oreo-shake", "Oreo Shake", "Shakes", 150),
  item("mint-oreo-shake", "Mint Oreo Shake", "Shakes", 150),
  item("kitkat-shake", "KitKat Shake", "Shakes", 150),
  item("chocolate-shake", "Chocolate Shake", "Shakes", 150),
  item("strawberry-shake", "Strawberry Shake", "Shakes", 120),
  item("orange-shake", "Orange Shake", "Shakes", 120),
  item("butterscotch-shake", "Butterscotch Shake", "Shakes", 120),

  // Refreshing Beverages
  item("fresh-lime-water", "Fresh Lime Water", "Refreshing Beverages", 69),
  item("fresh-lime-soda", "Fresh Lime Soda", "Refreshing Beverages", 99),
  item("lemon-ice-tea", "Lemon Ice Tea", "Refreshing Beverages", 99),
  item("virgin-mojito", "Virgin Mojito", "Refreshing Beverages", 99),
  item("green-mint-mojito", "Green Mint Mojito", "Refreshing Beverages", 99),
  item("blue-mojito", "Blue Mojito", "Refreshing Beverages", 99),
  item("orange-mojito", "Orange Mojito", "Refreshing Beverages", 99),
  item("watermelon-punch", "Watermelon Punch", "Refreshing Beverages", 99)
];

function item(id: string, name: string, category: string, price: number, second?: number): MenuItem {
  return {
    id,
    name,
    category,
    prices: second
      ? [
          { label: "Half", price },
          { label: "Full", price: second }
        ]
      : [{ label: "Regular", price }]
  };
}
