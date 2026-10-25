export type ShopItemId =
  | 'raft'
  | 'swim'
  | 'unlock'
  | 'potionRed'
  | 'potionBlue'
  | 'potionGreen'
  | 'coconut'
  | 'pbj'
  | 'waterBottle'
  | 'waterJug'

export interface ShopItem {
  id: ShopItemId
  name: string
  description: string
  price: number
  kind: 'unlock' | 'consumable'
  once?: boolean
}

export const SHOP_ITEMS: ShopItem[] = [
  {
    id: 'raft',
    name: 'Build a Raft',
    description: 'Craft a driftwood raft. Ride waves and travel the open ocean without drowning.',
    price: 15,
    kind: 'unlock',
    once: true,
  },
  {
    id: 'swim',
    name: 'Swimming Ability',
    description: 'Learn to paddle. Enter water safely and explore lagoons by swimming.',
    price: 10,
    kind: 'unlock',
    once: true,
  },
  {
    id: 'unlock',
    name: 'North Cove Key',
    description: 'Open the gated North Cove — denser bananas and a scenic overlook.',
    price: 20,
    kind: 'unlock',
    once: true,
  },
  {
    id: 'potionRed',
    name: 'Ruby Sprint Potion',
    description: 'Brief burst of running speed for 12 seconds.',
    price: 5,
    kind: 'consumable',
  },
  {
    id: 'potionBlue',
    name: 'Azure Leap Potion',
    description: 'Extra jump height for 15 seconds.',
    price: 5,
    kind: 'consumable',
  },
  {
    id: 'potionGreen',
    name: 'Jade Guard Potion',
    description: 'Survive one drowning mishap within 45 seconds.',
    price: 4,
    kind: 'consumable',
  },
  {
    id: 'coconut',
    name: 'Fresh Coconut',
    description: 'Restores stamina feel — short walk-speed refresh for 8 seconds.',
    price: 3,
    kind: 'consumable',
  },
  {
    id: 'pbj',
    name: 'PB&J Sandwich',
    description: 'Hearty snack. Speed + jump boost for 10 seconds.',
    price: 8,
    kind: 'consumable',
  },
  {
    id: 'waterBottle',
    name: 'Water Bottle',
    description: 'Cool sip. Slightly longer swim stamina window feel (move boost in water).',
    price: 2,
    kind: 'consumable',
  },
  {
    id: 'waterJug',
    name: 'Water Jug',
    description: 'Big gulp. Stronger water move boost for 20 seconds.',
    price: 6,
    kind: 'consumable',
  },
]
