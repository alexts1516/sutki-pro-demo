// Shared owner/guest vocabulary; selection is stored per apartment.
export const AMENITY_GROUPS = [
  {
    "id": "internet",
    "ru": "Интернет и работа",
    "en": "Internet and work",
    "icon": "wifi",
    "items": [
      {
        "id": "wifi",
        "ru": "Wi-Fi",
        "en": "Wi-Fi"
      },
      {
        "id": "ethernet",
        "ru": "Проводной интернет",
        "en": "Ethernet"
      },
      {
        "id": "workspace",
        "ru": "Рабочее место",
        "en": "Workspace"
      },
      {
        "id": "desk",
        "ru": "Письменный стол",
        "en": "Desk"
      },
      {
        "id": "office-chair",
        "ru": "Рабочее кресло",
        "en": "Office chair"
      }
    ]
  },
  {
    "id": "kitchen",
    "ru": "Кухня",
    "en": "Kitchen",
    "icon": "home",
    "items": [
      {
        "id": "kitchen",
        "ru": "Кухня",
        "en": "Kitchen"
      },
      {
        "id": "fridge",
        "ru": "Холодильник",
        "en": "Refrigerator"
      },
      {
        "id": "freezer",
        "ru": "Морозильная камера",
        "en": "Freezer"
      },
      {
        "id": "stove",
        "ru": "Плита",
        "en": "Stove"
      },
      {
        "id": "oven",
        "ru": "Духовка",
        "en": "Oven"
      },
      {
        "id": "microwave",
        "ru": "Микроволновая печь",
        "en": "Microwave"
      },
      {
        "id": "dishwasher",
        "ru": "Посудомоечная машина",
        "en": "Dishwasher"
      },
      {
        "id": "kettle",
        "ru": "Чайник",
        "en": "Kettle"
      },
      {
        "id": "coffee-maker",
        "ru": "Кофеварка",
        "en": "Coffee maker"
      },
      {
        "id": "toaster",
        "ru": "Тостер",
        "en": "Toaster"
      },
      {
        "id": "dishes",
        "ru": "Посуда и столовые приборы",
        "en": "Dishes and cutlery"
      },
      {
        "id": "cookware",
        "ru": "Кастрюли и сковороды",
        "en": "Pots and pans"
      },
      {
        "id": "dining-table",
        "ru": "Обеденный стол",
        "en": "Dining table"
      }
    ]
  },
  {
    "id": "bathroom",
    "ru": "Ванная комната",
    "en": "Bathroom",
    "icon": "sparkle",
    "items": [
      {
        "id": "shower",
        "ru": "Душ",
        "en": "Shower"
      },
      {
        "id": "bathtub",
        "ru": "Ванна",
        "en": "Bathtub"
      },
      {
        "id": "hot-water",
        "ru": "Горячая вода",
        "en": "Hot water"
      },
      {
        "id": "hairdryer",
        "ru": "Фен",
        "en": "Hair dryer"
      },
      {
        "id": "towels",
        "ru": "Полотенца",
        "en": "Towels"
      },
      {
        "id": "shampoo",
        "ru": "Шампунь",
        "en": "Shampoo"
      },
      {
        "id": "soap",
        "ru": "Мыло и гель для душа",
        "en": "Soap and shower gel"
      },
      {
        "id": "toilet-paper",
        "ru": "Туалетная бумага",
        "en": "Toilet paper"
      },
      {
        "id": "bathrobe",
        "ru": "Халат",
        "en": "Bathrobe"
      }
    ]
  },
  {
    "id": "laundry",
    "ru": "Стирка и уход",
    "en": "Laundry",
    "icon": "home",
    "items": [
      {
        "id": "washing-machine",
        "ru": "Стиральная машина",
        "en": "Washing machine"
      },
      {
        "id": "dryer",
        "ru": "Сушильная машина",
        "en": "Dryer"
      },
      {
        "id": "drying-rack",
        "ru": "Сушилка для белья",
        "en": "Drying rack"
      },
      {
        "id": "iron",
        "ru": "Утюг",
        "en": "Iron"
      },
      {
        "id": "ironing-board",
        "ru": "Гладильная доска",
        "en": "Ironing board"
      },
      {
        "id": "detergent",
        "ru": "Средство для стирки",
        "en": "Laundry detergent"
      }
    ]
  },
  {
    "id": "bedroom",
    "ru": "Спальня и хранение",
    "en": "Bedroom and storage",
    "icon": "bed",
    "items": [
      {
        "id": "bed-linen",
        "ru": "Постельное бельё",
        "en": "Bed linen"
      },
      {
        "id": "extra-pillows",
        "ru": "Дополнительные подушки и одеяла",
        "en": "Extra pillows and blankets"
      },
      {
        "id": "blackout-curtains",
        "ru": "Плотные шторы",
        "en": "Blackout curtains"
      },
      {
        "id": "wardrobe",
        "ru": "Шкаф",
        "en": "Wardrobe"
      },
      {
        "id": "hangers",
        "ru": "Вешалки",
        "en": "Hangers"
      },
      {
        "id": "sofa-bed",
        "ru": "Раскладной диван",
        "en": "Sofa bed"
      },
      {
        "id": "safe",
        "ru": "Сейф",
        "en": "Safe"
      }
    ]
  },
  {
    "id": "climate",
    "ru": "Температура и воздух",
    "en": "Heating and cooling",
    "icon": "moon",
    "items": [
      {
        "id": "air-conditioning",
        "ru": "Кондиционер",
        "en": "Air conditioning"
      },
      {
        "id": "heating",
        "ru": "Отопление",
        "en": "Heating"
      },
      {
        "id": "fan",
        "ru": "Вентилятор",
        "en": "Fan"
      },
      {
        "id": "humidifier",
        "ru": "Увлажнитель воздуха",
        "en": "Humidifier"
      },
      {
        "id": "air-purifier",
        "ru": "Очиститель воздуха",
        "en": "Air purifier"
      }
    ]
  },
  {
    "id": "entertainment",
    "ru": "Отдых",
    "en": "Entertainment",
    "icon": "star",
    "items": [
      {
        "id": "tv",
        "ru": "Телевизор",
        "en": "TV"
      },
      {
        "id": "smart-tv",
        "ru": "Smart TV",
        "en": "Smart TV"
      },
      {
        "id": "cable-tv",
        "ru": "Кабельное телевидение",
        "en": "Cable TV"
      },
      {
        "id": "board-games",
        "ru": "Настольные игры",
        "en": "Board games"
      },
      {
        "id": "books",
        "ru": "Книги",
        "en": "Books"
      }
    ]
  },
  {
    "id": "family",
    "ru": "Для семьи",
    "en": "Family",
    "icon": "users",
    "items": [
      {
        "id": "crib",
        "ru": "Детская кроватка",
        "en": "Crib"
      },
      {
        "id": "high-chair",
        "ru": "Детский стульчик",
        "en": "High chair"
      },
      {
        "id": "baby-bath",
        "ru": "Детская ванночка",
        "en": "Baby bath"
      },
      {
        "id": "child-dishes",
        "ru": "Детская посуда",
        "en": "Children’s dishes"
      },
      {
        "id": "window-guards",
        "ru": "Защита на окнах",
        "en": "Window guards"
      }
    ]
  },
  {
    "id": "building",
    "ru": "Дом и территория",
    "en": "Building and outdoor space",
    "icon": "building",
    "items": [
      {
        "id": "elevator",
        "ru": "Лифт",
        "en": "Elevator"
      },
      {
        "id": "balcony",
        "ru": "Балкон",
        "en": "Balcony"
      },
      {
        "id": "terrace",
        "ru": "Терраса",
        "en": "Terrace"
      },
      {
        "id": "courtyard",
        "ru": "Двор",
        "en": "Courtyard"
      },
      {
        "id": "playground",
        "ru": "Детская площадка",
        "en": "Playground"
      },
      {
        "id": "gym",
        "ru": "Спортзал",
        "en": "Gym"
      },
      {
        "id": "pool",
        "ru": "Бассейн",
        "en": "Pool"
      },
      {
        "id": "outdoor-furniture",
        "ru": "Уличная мебель",
        "en": "Outdoor furniture"
      }
    ]
  },
  {
    "id": "parking",
    "ru": "Парковка и доступ",
    "en": "Parking and access",
    "icon": "car",
    "items": [
      {
        "id": "free-parking",
        "ru": "Бесплатная парковка",
        "en": "Free parking"
      },
      {
        "id": "paid-parking",
        "ru": "Платная парковка",
        "en": "Paid parking"
      },
      {
        "id": "garage",
        "ru": "Подземная парковка",
        "en": "Underground parking"
      },
      {
        "id": "ev-charger",
        "ru": "Зарядка электромобиля",
        "en": "EV charger"
      },
      {
        "id": "step-free",
        "ru": "Вход без ступеней",
        "en": "Step-free entrance"
      },
      {
        "id": "wide-door",
        "ru": "Широкий дверной проём",
        "en": "Wide doorway"
      }
    ]
  },
  {
    "id": "safety",
    "ru": "Безопасность",
    "en": "Safety",
    "icon": "shield",
    "items": [
      {
        "id": "smoke-alarm",
        "ru": "Датчик дыма",
        "en": "Smoke alarm"
      },
      {
        "id": "co-alarm",
        "ru": "Датчик угарного газа",
        "en": "Carbon monoxide alarm"
      },
      {
        "id": "fire-extinguisher",
        "ru": "Огнетушитель",
        "en": "Fire extinguisher"
      },
      {
        "id": "first-aid",
        "ru": "Аптечка",
        "en": "First-aid kit"
      },
      {
        "id": "security",
        "ru": "Охрана дома",
        "en": "Building security"
      },
      {
        "id": "self-checkin",
        "ru": "Самостоятельное заселение",
        "en": "Self check-in"
      }
    ]
  }
];
export const AMENITY_IDS = AMENITY_GROUPS.flatMap(g=>g.items.map(i=>i.id));
