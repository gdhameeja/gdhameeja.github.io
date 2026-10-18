'use strict';
// ============================================================================
//  Age of Crowns — static game data: terrain, units, buildings, techs, civs.
//  Everything here is plain data (plus small effect functions applied to a
//  Player at runtime). Numbers are loosely modelled on AoE2 values.
// ============================================================================

const TW = 64, TH = 32, HW = 32, HH = 16;   // isometric tile size in pixels
const SIM_DT = 0.05;                         // simulation step (game seconds)
const RES = ['food', 'wood', 'gold', 'stone'];
const AGES = ['Dark Age', 'Feudal Age', 'Castle Age', 'Imperial Age'];
const MAX_POP = 200;

// ---------------------------------------------------------------- terrain
const T = { GRASS: 0, DIRT: 1, SAND: 2, SNOW: 3, ICE: 4, SHALLOW: 5, WATER: 6, LEAVES: 7 };
const TERRAINS = [
  { name: 'Grass',    pass: true,  build: true,  mini: '#5d8a34', prio: 5,
    base: ['#5f8f35', '#679a3a', '#58852f'], speck: ['#7aae46', '#4b7a28', '#86b852'] },
  { name: 'Dirt',     pass: true,  build: true,  mini: '#8f7449', prio: 4,
    base: ['#8c7148', '#957a4e', '#836840'], speck: ['#a58a5c', '#6f5734', '#9b8358'] },
  { name: 'Sand',     pass: true,  build: true,  mini: '#d2bb7e', prio: 3,
    base: ['#d6c085', '#dcc78f', '#cdb678'], speck: ['#e8d8a4', '#bfa868', '#c9b37a'] },
  { name: 'Snow',     pass: true,  build: true,  mini: '#e3eaee', prio: 6,
    base: ['#e6edf1', '#eef3f6', '#dbe4ea'], speck: ['#ffffff', '#c8d4dc', '#d2dde4'] },
  { name: 'Ice',      pass: true,  build: false, mini: '#a8cfe0', prio: 2,
    base: ['#a9d0e2', '#b4d8e8', '#9cc6da'], speck: ['#d6eef8', '#8ab8ce', '#c4e3f0'] },
  { name: 'Shallows', pass: true,  build: false, mini: '#5f9fae', prio: 1,
    base: ['#6aa6b2', '#72adb8', '#629eab'], speck: ['#8cc2c8', '#55919e', '#a3cfd0'] },
  { name: 'Water',    pass: false, build: false, mini: '#2b5f8c', prio: 0,
    base: ['#2d6491', '#306a98', '#2a5d89'], speck: ['#3b78a6', '#25557f', '#4282ae'] },
  { name: 'Forest floor', pass: true, build: true, mini: '#4a6a2a', prio: 5.5,
    base: ['#4d6b2c', '#536f30', '#476428'], speck: ['#6b5a32', '#3d5a22', '#62803a'] },
];

// ---------------------------------------------------------------- players
const PLAYER_COLORS = [
  { name: 'Nature', main: '#d8d0b8', dark: '#9a927a', light: '#f2ecd8' },
  { name: 'Blue',   main: '#2f62d6', dark: '#1b3a8a', light: '#83a7ff' },
  { name: 'Red',    main: '#d0362a', dark: '#841d14', light: '#ff8a7c' },
  { name: 'Green',  main: '#38a33a', dark: '#1d6320', light: '#8fe08a' },
  { name: 'Yellow', main: '#e2c022', dark: '#8f7808', light: '#fff07a' },
  { name: 'Cyan',   main: '#22b2c2', dark: '#0e6a75', light: '#86ecf5' },
  { name: 'Purple', main: '#9a3ec8', dark: '#5a1c7a', light: '#d29af2' },
  { name: 'Orange', main: '#ec8426', dark: '#93480a', light: '#ffc07e' },
  { name: 'Grey',   main: '#8c8c8c', dark: '#4a4a4a', light: '#d0d0d0' },
];

// ---------------------------------------------------------------- resources
const RESOURCES = {
  tree:    { name: 'Tree',        res: 'wood',  amount: 100, blocks: true },
  berry:   { name: 'Berry Bush',  res: 'food',  amount: 125, blocks: true, gather: 'forage' },
  gold:    { name: 'Gold Mine',   res: 'gold',  amount: 800, blocks: true },
  stone:   { name: 'Stone Mine',  res: 'stone', amount: 350, blocks: true },
  carcass: { name: 'Carcass',     res: 'food',  amount: 100, blocks: false, gather: 'hunt' },
};

// Base gather rates (resource units per game second)
const GATHER_RATES = { forage: 0.31, hunt: 0.41, sheep: 0.33, farm: 0.32, wood: 0.39, gold: 0.38, stone: 0.36 };

// ---------------------------------------------------------------- units
// armor: {m: melee, p: pierce}. bonus: extra damage vs class.
const UNITS = {
  villager: {
    name: 'Villager', desc: 'Gathers resources, constructs and repairs buildings.',
    cost: { food: 50 }, time: 25, hp: 25, atk: 3, atkType: 'melee', range: 0, reload: 2,
    speed: 0.8, los: 4, armor: { m: 0, p: 0 }, classes: ['villager'], radius: 0.2,
    at: 'towncenter', age: 0, sprite: { body: 'villager' }, garrisonable: true,
  },
  // ---- infantry
  militia: {
    name: 'Militia', line: 'militia', desc: 'Basic swordsman. Good against buildings and skirmishers.',
    cost: { food: 60, gold: 20 }, time: 21, hp: 40, atk: 4, atkType: 'melee', range: 0, reload: 2,
    speed: 0.9, los: 4, armor: { m: 0, p: 1 }, bonus: { building: 2 }, classes: ['infantry'], radius: 0.22,
    at: 'barracks', age: 0, sprite: { body: 'human', weapon: 'sword', armor: 'leather', helm: 'cap' }, garrisonable: true,
  },
  manatarms: {
    name: 'Man-at-Arms', line: 'militia', desc: 'Armored swordsman, a strong early infantry.',
    cost: { food: 60, gold: 20 }, time: 21, hp: 45, atk: 6, atkType: 'melee', range: 0, reload: 2,
    speed: 0.9, los: 4, armor: { m: 0, p: 1 }, bonus: { building: 2 }, classes: ['infantry'], radius: 0.22,
    at: 'barracks', age: 1, sprite: { body: 'human', weapon: 'sword', armor: 'chain', helm: 'helm', shield: true }, garrisonable: true,
  },
  longswordsman: {
    name: 'Long Swordsman', line: 'militia', desc: 'Heavily armored swordsman.',
    cost: { food: 60, gold: 20 }, time: 21, hp: 60, atk: 9, atkType: 'melee', range: 0, reload: 2,
    speed: 0.9, los: 4, armor: { m: 1, p: 1 }, bonus: { building: 3 }, classes: ['infantry'], radius: 0.22,
    at: 'barracks', age: 2, sprite: { body: 'human', weapon: 'longsword', armor: 'plate', helm: 'greathelm', shield: true }, garrisonable: true,
  },
  champion: {
    name: 'Champion', line: 'militia', desc: 'Elite heavy swordsman.',
    cost: { food: 60, gold: 20 }, time: 21, hp: 70, atk: 13, atkType: 'melee', range: 0, reload: 2,
    speed: 0.9, los: 5, armor: { m: 1, p: 1 }, bonus: { building: 4 }, classes: ['infantry'], radius: 0.23,
    at: 'barracks', age: 3, sprite: { body: 'human', weapon: 'greatsword', armor: 'plate', helm: 'greathelm', cape: true }, garrisonable: true,
  },
  spearman: {
    name: 'Spearman', line: 'spearman', desc: 'Cheap anti-cavalry infantry.',
    cost: { food: 35, wood: 25 }, time: 22, hp: 45, atk: 3, atkType: 'melee', range: 0, reload: 3,
    speed: 1.0, los: 4, armor: { m: 0, p: 0 }, bonus: { cavalry: 15 }, classes: ['infantry', 'spear'], radius: 0.22,
    at: 'barracks', age: 1, sprite: { body: 'human', weapon: 'spear', armor: 'leather', helm: 'cap' }, garrisonable: true,
  },
  pikeman: {
    name: 'Pikeman', line: 'spearman', desc: 'Strong anti-cavalry infantry.',
    cost: { food: 35, wood: 25 }, time: 22, hp: 55, atk: 4, atkType: 'melee', range: 0, reload: 3,
    speed: 1.0, los: 4, armor: { m: 0, p: 0 }, bonus: { cavalry: 22 }, classes: ['infantry', 'spear'], radius: 0.22,
    at: 'barracks', age: 2, sprite: { body: 'human', weapon: 'pike', armor: 'chain', helm: 'helm' }, garrisonable: true,
  },
  halberdier: {
    name: 'Halberdier', line: 'spearman', desc: 'Elite anti-cavalry infantry.',
    cost: { food: 35, wood: 25 }, time: 22, hp: 60, atk: 6, atkType: 'melee', range: 0, reload: 3,
    speed: 1.0, los: 4, armor: { m: 0, p: 0 }, bonus: { cavalry: 32 }, classes: ['infantry', 'spear'], radius: 0.22,
    at: 'barracks', age: 3, sprite: { body: 'human', weapon: 'halberd', armor: 'plate', helm: 'helm' }, garrisonable: true,
  },
  // ---- archers
  archer: {
    name: 'Archer', line: 'archer', desc: 'Ranged foot soldier. Weak to skirmishers and cavalry.',
    cost: { wood: 25, gold: 45 }, time: 35, hp: 30, atk: 4, atkType: 'pierce', range: 4, reload: 2,
    speed: 0.96, los: 6, armor: { m: 0, p: 0 }, bonus: { spear: 3 }, classes: ['archer', 'footarcher'], radius: 0.2,
    proj: 'arrow', accuracy: 0.8, at: 'archeryrange', age: 1, sprite: { body: 'human', weapon: 'bow', armor: 'leather', helm: 'hood' }, garrisonable: true,
  },
  crossbowman: {
    name: 'Crossbowman', line: 'archer', desc: 'Improved archer with greater range.',
    cost: { wood: 25, gold: 45 }, time: 27, hp: 35, atk: 5, atkType: 'pierce', range: 5, reload: 2,
    speed: 0.96, los: 7, armor: { m: 0, p: 0 }, bonus: { spear: 3 }, classes: ['archer', 'footarcher'], radius: 0.2,
    proj: 'bolt', accuracy: 0.85, at: 'archeryrange', age: 2, sprite: { body: 'human', weapon: 'crossbow', armor: 'chain', helm: 'kettle' }, garrisonable: true,
  },
  arbalester: {
    name: 'Arbalester', line: 'archer', desc: 'Elite crossbowman.',
    cost: { wood: 25, gold: 45 }, time: 27, hp: 40, atk: 6, atkType: 'pierce', range: 5, reload: 2,
    speed: 0.96, los: 7, armor: { m: 0, p: 0 }, bonus: { spear: 3 }, classes: ['archer', 'footarcher'], radius: 0.2,
    proj: 'bolt', accuracy: 0.9, at: 'archeryrange', age: 3, sprite: { body: 'human', weapon: 'crossbow', armor: 'plate', helm: 'kettle', cape: true }, garrisonable: true,
  },
  skirmisher: {
    name: 'Skirmisher', line: 'skirmisher', desc: 'Cheap anti-archer javelin thrower.',
    cost: { food: 25, wood: 35 }, time: 22, hp: 30, atk: 2, atkType: 'pierce', range: 4, reload: 3,
    speed: 0.96, los: 6, armor: { m: 0, p: 3 }, bonus: { archer: 3, spear: 1 }, classes: ['archer', 'footarcher'], radius: 0.2,
    proj: 'javelin', accuracy: 0.9, at: 'archeryrange', age: 1, sprite: { body: 'human', weapon: 'javelin', armor: 'leather', helm: 'none', shield: true }, garrisonable: true,
  },
  eliteskirmisher: {
    name: 'Elite Skirmisher', line: 'skirmisher', desc: 'Improved anti-archer unit.',
    cost: { food: 25, wood: 35 }, time: 22, hp: 35, atk: 3, atkType: 'pierce', range: 5, reload: 3,
    speed: 0.96, los: 7, armor: { m: 0, p: 4 }, bonus: { archer: 4, spear: 1 }, classes: ['archer', 'footarcher'], radius: 0.2,
    proj: 'javelin', accuracy: 0.9, at: 'archeryrange', age: 2, sprite: { body: 'human', weapon: 'javelin', armor: 'chain', helm: 'cap', shield: true }, garrisonable: true,
  },
  cavalryarcher: {
    name: 'Cavalry Archer', line: 'cavalryarcher', desc: 'Fast mounted archer.',
    cost: { wood: 40, gold: 70 }, time: 34, hp: 50, atk: 6, atkType: 'pierce', range: 4, reload: 2,
    speed: 1.4, los: 5, armor: { m: 0, p: 0 }, bonus: { spear: 2 }, classes: ['cavalry', 'archer'], radius: 0.34,
    proj: 'arrow', accuracy: 0.8, at: 'archeryrange', age: 2, sprite: { body: 'horse', horse: 'bay', rider: { weapon: 'bow', armor: 'leather', helm: 'hood' } },
  },
  heavycavalryarcher: {
    name: 'Heavy Cavalry Archer', line: 'cavalryarcher', desc: 'Armored mounted archer.',
    cost: { wood: 40, gold: 70 }, time: 27, hp: 60, atk: 7, atkType: 'pierce', range: 4, reload: 2,
    speed: 1.4, los: 6, armor: { m: 1, p: 0 }, bonus: { spear: 2 }, classes: ['cavalry', 'archer'], radius: 0.34,
    proj: 'arrow', accuracy: 0.85, at: 'archeryrange', age: 3, sprite: { body: 'horse', horse: 'black', rider: { weapon: 'bow', armor: 'chain', helm: 'helm' } },
  },
  // ---- cavalry
  scoutcavalry: {
    name: 'Scout Cavalry', line: 'scoutcavalry', desc: 'Fast light horseman. Great for scouting and raiding.',
    cost: { food: 80 }, time: 30, hp: 45, atk: 3, atkType: 'melee', range: 0, reload: 2,
    speed: 1.55, los: 6, armor: { m: 0, p: 2 }, bonus: { monk: 6 }, classes: ['cavalry'], radius: 0.34,
    at: 'stable', age: 1, sprite: { body: 'horse', horse: 'bay', rider: { weapon: 'sword', armor: 'leather', helm: 'cap' } },
  },
  lightcavalry: {
    name: 'Light Cavalry', line: 'scoutcavalry', desc: 'Improved fast horseman.',
    cost: { food: 80 }, time: 30, hp: 60, atk: 7, atkType: 'melee', range: 0, reload: 2,
    speed: 1.5, los: 8, armor: { m: 0, p: 2 }, bonus: { monk: 10 }, classes: ['cavalry'], radius: 0.34,
    at: 'stable', age: 2, sprite: { body: 'horse', horse: 'grey', rider: { weapon: 'sword', armor: 'chain', helm: 'helm' } },
  },
  hussar: {
    name: 'Hussar', line: 'scoutcavalry', desc: 'Elite light cavalry.',
    cost: { food: 80 }, time: 30, hp: 75, atk: 7, atkType: 'melee', range: 0, reload: 1.9,
    speed: 1.5, los: 10, armor: { m: 0, p: 2 }, bonus: { monk: 12 }, classes: ['cavalry'], radius: 0.34,
    at: 'stable', age: 3, sprite: { body: 'horse', horse: 'white', rider: { weapon: 'sword', armor: 'chain', helm: 'feather', cape: true } },
  },
  knight: {
    name: 'Knight', line: 'knight', desc: 'Heavily armored, powerful cavalry.',
    cost: { food: 60, gold: 75 }, time: 30, hp: 100, atk: 10, atkType: 'melee', range: 0, reload: 1.8,
    speed: 1.35, los: 4, armor: { m: 2, p: 2 }, classes: ['cavalry'], radius: 0.36,
    at: 'stable', age: 2, sprite: { body: 'horse', horse: 'bay', barding: true, rider: { weapon: 'sword', armor: 'plate', helm: 'greathelm', shield: true } },
  },
  cavalier: {
    name: 'Cavalier', line: 'knight', desc: 'Improved knight.',
    cost: { food: 60, gold: 75 }, time: 30, hp: 120, atk: 12, atkType: 'melee', range: 0, reload: 1.8,
    speed: 1.35, los: 4, armor: { m: 2, p: 2 }, classes: ['cavalry'], radius: 0.36,
    at: 'stable', age: 3, sprite: { body: 'horse', horse: 'grey', barding: true, rider: { weapon: 'sword', armor: 'plate', helm: 'greathelm', shield: true, cape: true } },
  },
  paladin: {
    name: 'Paladin', line: 'knight', desc: 'The ultimate heavy cavalry.',
    cost: { food: 60, gold: 75 }, time: 30, hp: 160, atk: 14, atkType: 'melee', range: 0, reload: 1.9,
    speed: 1.35, los: 5, armor: { m: 2, p: 3 }, classes: ['cavalry'], radius: 0.37,
    at: 'stable', age: 3, sprite: { body: 'horse', horse: 'white', barding: true, rider: { weapon: 'sword', armor: 'gold', helm: 'crown', shield: true, cape: true } },
  },
  // ---- siege
  batteringram: {
    name: 'Battering Ram', line: 'batteringram', desc: 'Siege weapon that devastates buildings. Immune to most arrows.',
    cost: { wood: 160, gold: 75 }, time: 36, hp: 175, atk: 2, atkType: 'melee', range: 0, reload: 5,
    speed: 0.5, los: 3, armor: { m: -3, p: 180 }, bonus: { building: 125, siege: 40 }, classes: ['siege'], radius: 0.45,
    at: 'siegeworkshop', age: 2, sprite: { body: 'ram' }, buildingsOnly: true, garrisonable: false,
  },
  cappedram: {
    name: 'Capped Ram', line: 'batteringram', desc: 'Reinforced battering ram.',
    cost: { wood: 160, gold: 75 }, time: 36, hp: 200, atk: 3, atkType: 'melee', range: 0, reload: 5,
    speed: 0.5, los: 3, armor: { m: -3, p: 190 }, bonus: { building: 150, siege: 50 }, classes: ['siege'], radius: 0.45,
    at: 'siegeworkshop', age: 3, sprite: { body: 'ram', capped: true }, buildingsOnly: true,
  },
  mangonel: {
    name: 'Mangonel', line: 'mangonel', desc: 'Hurls stones that damage everything in an area — including your own units.',
    cost: { wood: 160, gold: 135 }, time: 46, hp: 50, atk: 40, atkType: 'melee', range: 7, minRange: 3, reload: 6,
    speed: 0.6, los: 9, armor: { m: 0, p: 6 }, bonus: { building: 35, siege: 12 }, classes: ['siege'], radius: 0.42,
    proj: 'stone', splash: 0.6, accuracy: 1, ballistic: true, at: 'siegeworkshop', age: 2, sprite: { body: 'mangonel' },
  },
  onager: {
    name: 'Onager', line: 'mangonel', desc: 'Improved mangonel with larger area damage.',
    cost: { wood: 160, gold: 135 }, time: 46, hp: 60, atk: 50, atkType: 'melee', range: 8, minRange: 3, reload: 6,
    speed: 0.6, los: 10, armor: { m: 0, p: 7 }, bonus: { building: 45, siege: 12 }, classes: ['siege'], radius: 0.42,
    proj: 'stone', splash: 0.9, accuracy: 1, ballistic: true, at: 'siegeworkshop', age: 3, sprite: { body: 'mangonel', onager: true },
  },
  trebuchet: {
    name: 'Trebuchet', desc: 'Long-range siege engine. Smashes buildings from afar; inaccurate against units.',
    cost: { wood: 200, gold: 200 }, time: 50, hp: 150, atk: 200, atkType: 'melee', range: 16, minRange: 4, reload: 10,
    speed: 0.7, los: 19, armor: { m: 2, p: 150 }, bonus: { building: 250 }, classes: ['siege'], radius: 0.5,
    proj: 'boulder', splash: 0.5, ballistic: true, at: 'castle', age: 3, sprite: { body: 'trebuchet' }, pop: 1,
  },
  // ---- monk
  monk: {
    name: 'Monk', desc: 'Heals friendly units and converts enemy units to your side.',
    cost: { gold: 100 }, time: 51, hp: 30, atk: 0, atkType: 'melee', range: 9, reload: 1,
    speed: 0.7, los: 11, armor: { m: 0, p: 0 }, classes: ['monk'], radius: 0.2,
    at: 'monastery', age: 2, sprite: { body: 'monk' }, garrisonable: true, monk: true,
  },
  // ---- unique units
  longbowman: {
    name: 'Longbowman', line: 'longbowman', unique: 'britons', desc: 'Briton unique unit. Archer with exceptional range.',
    cost: { wood: 35, gold: 40 }, time: 18, hp: 35, atk: 6, atkType: 'pierce', range: 5, reload: 2,
    speed: 0.96, los: 7, armor: { m: 0, p: 1 }, bonus: { spear: 3 }, classes: ['archer', 'footarcher', 'unique'], radius: 0.2,
    proj: 'arrow', accuracy: 0.8, at: 'castle', age: 2, sprite: { body: 'human', weapon: 'longbow', armor: 'leather', helm: 'hood', cape: true }, garrisonable: true,
  },
  elitelongbowman: {
    name: 'Elite Longbowman', line: 'longbowman', unique: 'britons', desc: 'Elite Briton archer.',
    cost: { wood: 35, gold: 40 }, time: 18, hp: 40, atk: 7, atkType: 'pierce', range: 6, reload: 2,
    speed: 0.96, los: 8, armor: { m: 0, p: 1 }, bonus: { spear: 3 }, classes: ['archer', 'footarcher', 'unique'], radius: 0.2,
    proj: 'arrow', accuracy: 0.9, at: 'castle', age: 3, sprite: { body: 'human', weapon: 'longbow', armor: 'chain', helm: 'hood', cape: true }, garrisonable: true,
  },
  throwingaxeman: {
    name: 'Throwing Axeman', line: 'throwingaxeman', unique: 'franks', desc: 'Frankish unique unit. Infantry that hurls axes (melee damage at range).',
    cost: { food: 55, gold: 25 }, time: 17, hp: 60, atk: 7, atkType: 'melee', range: 3, reload: 2,
    speed: 1.0, los: 5, armor: { m: 0, p: 0 }, bonus: { building: 2 }, classes: ['infantry', 'unique'], radius: 0.22,
    proj: 'axe', accuracy: 1, at: 'castle', age: 2, sprite: { body: 'human', weapon: 'axe', armor: 'leather', helm: 'none', shield: true }, garrisonable: true,
  },
  elitethrowingaxeman: {
    name: 'Elite Throwing Axeman', line: 'throwingaxeman', unique: 'franks', desc: 'Elite Frankish axeman.',
    cost: { food: 55, gold: 25 }, time: 17, hp: 70, atk: 8, atkType: 'melee', range: 4, reload: 2,
    speed: 1.0, los: 6, armor: { m: 1, p: 1 }, bonus: { building: 3 }, classes: ['infantry', 'unique'], radius: 0.22,
    proj: 'axe', accuracy: 1, at: 'castle', age: 3, sprite: { body: 'human', weapon: 'axe', armor: 'chain', helm: 'helm', shield: true }, garrisonable: true,
  },
  mangudai: {
    name: 'Mangudai', line: 'mangudai', unique: 'mongols', desc: 'Mongol unique unit. Fast horse archer, deadly against siege.',
    cost: { wood: 55, gold: 65 }, time: 26, hp: 60, atk: 6, atkType: 'pierce', range: 4, reload: 2.1,
    speed: 1.45, los: 6, armor: { m: 0, p: 0 }, bonus: { siege: 3 }, classes: ['cavalry', 'archer', 'unique'], radius: 0.34,
    proj: 'arrow', accuracy: 0.95, at: 'castle', age: 2, sprite: { body: 'horse', horse: 'dun', rider: { weapon: 'bow', armor: 'leather', helm: 'fur' } },
  },
  elitemangudai: {
    name: 'Elite Mangudai', line: 'mangudai', unique: 'mongols', desc: 'Elite Mongol horse archer.',
    cost: { wood: 55, gold: 65 }, time: 26, hp: 60, atk: 8, atkType: 'pierce', range: 4, reload: 2.1,
    speed: 1.45, los: 6, armor: { m: 1, p: 1 }, bonus: { siege: 5 }, classes: ['cavalry', 'archer', 'unique'], radius: 0.34,
    proj: 'arrow', accuracy: 0.95, at: 'castle', age: 3, sprite: { body: 'horse', horse: 'black', rider: { weapon: 'bow', armor: 'chain', helm: 'fur', cape: true } },
  },
  cataphract: {
    name: 'Cataphract', line: 'cataphract', unique: 'byzantines', desc: 'Byzantine unique unit. Armored cavalry that crushes infantry.',
    cost: { food: 70, gold: 75 }, time: 20, hp: 110, atk: 9, atkType: 'melee', range: 0, reload: 1.8,
    speed: 1.35, los: 4, armor: { m: 2, p: 1 }, bonus: { infantry: 12 }, classes: ['cavalry', 'unique'], radius: 0.37,
    at: 'castle', age: 2, sprite: { body: 'horse', horse: 'black', barding: 'scale', rider: { weapon: 'mace', armor: 'scale', helm: 'spike' } },
  },
  elitecataphract: {
    name: 'Elite Cataphract', line: 'cataphract', unique: 'byzantines', desc: 'Elite Byzantine cavalry.',
    cost: { food: 70, gold: 75 }, time: 20, hp: 150, atk: 12, atkType: 'melee', range: 0, reload: 1.7,
    speed: 1.35, los: 5, armor: { m: 2, p: 1 }, bonus: { infantry: 16 }, classes: ['cavalry', 'unique'], radius: 0.37,
    at: 'castle', age: 3, sprite: { body: 'horse', horse: 'black', barding: 'scale', rider: { weapon: 'mace', armor: 'gold', helm: 'spike', cape: true } },
  },
  // ---- nature
  sheep: {
    name: 'Sheep', desc: 'Herdable livestock. Kill with a villager for food.', hp: 7, atk: 0, range: 0, reload: 2,
    speed: 0.7, los: 2, armor: { m: 0, p: 0 }, classes: ['animal', 'livestock'], radius: 0.22, food: 100,
    sprite: { body: 'sheep' }, animal: 'herd',
  },
  deer: {
    name: 'Deer', desc: 'Skittish game. Hunt it for food.', hp: 5, atk: 0, range: 0, reload: 2,
    speed: 1.1, los: 3, armor: { m: 0, p: 0 }, classes: ['animal'], radius: 0.24, food: 140,
    sprite: { body: 'deer' }, animal: 'flee',
  },
  boar: {
    name: 'Wild Boar', desc: 'Dangerous game. Fights back when hunted.', hp: 75, atk: 6, atkType: 'melee', range: 0, reload: 2,
    speed: 0.9, los: 4, armor: { m: 0, p: 1 }, classes: ['animal'], radius: 0.28, food: 340,
    sprite: { body: 'boar' }, animal: 'boar',
  },
  wolf: {
    name: 'Wolf', desc: 'Predator. Attacks anything that comes too close.', hp: 25, atk: 3, atkType: 'melee', range: 0, reload: 1.5,
    speed: 1.15, los: 5, armor: { m: 0, p: 0 }, classes: ['animal'], radius: 0.24, food: 0,
    sprite: { body: 'wolf' }, animal: 'predator',
  },
};

// ---------------------------------------------------------------- buildings
// size: footprint in tiles. drop: resources accepted. pop: housing provided.
const BUILDINGS = {
  towncenter: {
    name: 'Town Center', desc: 'Trains villagers, accepts all resources and researches the ages. Fires arrows at enemies.',
    size: 4, hp: 2400, cost: { wood: 275, stone: 100 }, time: 150, age: 2, armor: { m: 3, p: 5 }, los: 8,
    pop: 5, drop: ['food', 'wood', 'gold', 'stone'], trains: ['villager'], atk: 5, range: 6, reload: 2, arrows: 1,
    garrison: 15, menu: 'eco', hotkey: 'A',
  },
  house: {
    name: 'House', desc: 'Supports 5 population.', size: 2, hp: 550, cost: { wood: 25 }, time: 25, age: 0,
    armor: { m: 0, p: 7 }, los: 2, pop: 5, menu: 'eco',
  },
  mill: {
    name: 'Mill', desc: 'Drop-off point for food. Required to build farms. Researches farming upgrades.',
    size: 2, hp: 600, cost: { wood: 100 }, time: 35, age: 0, armor: { m: 0, p: 7 }, los: 6, drop: ['food'], menu: 'eco',
  },
  lumbercamp: {
    name: 'Lumber Camp', desc: 'Drop-off point for wood. Researches woodcutting upgrades.',
    size: 2, hp: 600, cost: { wood: 100 }, time: 35, age: 0, armor: { m: 0, p: 7 }, los: 6, drop: ['wood'], menu: 'eco',
  },
  miningcamp: {
    name: 'Mining Camp', desc: 'Drop-off point for gold and stone. Researches mining upgrades.',
    size: 2, hp: 600, cost: { wood: 100 }, time: 35, age: 0, armor: { m: 0, p: 7 }, los: 6, drop: ['gold', 'stone'], menu: 'eco',
  },
  farm: {
    name: 'Farm', desc: 'Renewable food source. One villager can farm at a time. Requires a Mill.',
    size: 3, hp: 480, cost: { wood: 60 }, time: 15, age: 0, armor: { m: 0, p: 0 }, los: 1, walkable: true, req: 'mill', menu: 'eco',
  },
  market: {
    name: 'Market', desc: 'Buy and sell resources for gold.', size: 3, hp: 1800, cost: { wood: 175 }, time: 60, age: 1,
    armor: { m: 0, p: 7 }, los: 6, req: 'mill', menu: 'eco',
  },
  blacksmith: {
    name: 'Blacksmith', desc: 'Researches attack and armor upgrades.', size: 3, hp: 1800, cost: { wood: 150 }, time: 40, age: 1,
    armor: { m: 1, p: 7 }, los: 6, menu: 'eco',
  },
  monastery: {
    name: 'Monastery', desc: 'Trains monks and researches religious technologies.', size: 3, hp: 2100, cost: { wood: 175 }, time: 40, age: 2,
    armor: { m: 0, p: 7 }, los: 6, trains: ['monk'], garrison: 10, menu: 'eco',
  },
  university: {
    name: 'University', desc: 'Researches building and siege technologies.', size: 3, hp: 2100, cost: { wood: 200 }, time: 60, age: 2,
    armor: { m: 0, p: 7 }, los: 6, menu: 'eco',
  },
  wonder: {
    name: 'Wonder', desc: 'A monument to your civilization. Defend it for 5 minutes to win the game.', size: 5, hp: 4800,
    cost: { wood: 1000, gold: 1000, stone: 1000 }, time: 500, age: 3, armor: { m: 1, p: 8 }, los: 8, menu: 'eco',
  },
  barracks: {
    name: 'Barracks', desc: 'Trains infantry.', size: 3, hp: 1200, cost: { wood: 175 }, time: 50, age: 0,
    armor: { m: 0, p: 7 }, los: 6, trains: ['militia', 'spearman'], garrison: 10, menu: 'mil',
  },
  archeryrange: {
    name: 'Archery Range', desc: 'Trains archers.', size: 3, hp: 1500, cost: { wood: 175 }, time: 50, age: 1,
    armor: { m: 0, p: 7 }, los: 6, trains: ['archer', 'skirmisher', 'cavalryarcher'], garrison: 10, req: 'barracks', menu: 'mil',
  },
  stable: {
    name: 'Stable', desc: 'Trains cavalry.', size: 3, hp: 1500, cost: { wood: 175 }, time: 50, age: 1,
    armor: { m: 0, p: 7 }, los: 6, trains: ['scoutcavalry', 'knight'], garrison: 10, req: 'barracks', menu: 'mil',
  },
  siegeworkshop: {
    name: 'Siege Workshop', desc: 'Builds siege weapons.', size: 4, hp: 2100, cost: { wood: 200 }, time: 40, age: 2,
    armor: { m: 0, p: 7 }, los: 6, trains: ['batteringram', 'mangonel'], req: 'blacksmith', menu: 'mil',
  },
  castle: {
    name: 'Castle', desc: 'Powerful fortification. Trains the unique unit and trebuchets.', size: 4, hp: 4800,
    cost: { stone: 650 }, time: 200, age: 2, armor: { m: 8, p: 11 }, los: 11, pop: 20, atk: 11, range: 8, reload: 2,
    arrows: 4, trains: ['UNIQUE', 'trebuchet'], garrison: 20, menu: 'mil',
  },
  watchtower: {
    name: 'Watch Tower', desc: 'Fires arrows at enemies in range.', size: 1, hp: 700, cost: { wood: 25, stone: 125 }, time: 80, age: 1,
    armor: { m: 1, p: 7 }, los: 10, atk: 5, range: 8, reload: 2, arrows: 1, garrison: 5, menu: 'mil',
  },
  palisade: {
    name: 'Palisade Wall', desc: 'Cheap wooden wall. Drag to build a line.', size: 1, hp: 250, cost: { wood: 2 }, time: 5, age: 0,
    armor: { m: 2, p: 5 }, los: 2, wall: true, menu: 'mil',
  },
  stonewall: {
    name: 'Stone Wall', desc: 'Strong stone wall. Drag to build a line.', size: 1, hp: 1800, cost: { stone: 5 }, time: 8, age: 1,
    armor: { m: 8, p: 10 }, los: 2, wall: true, menu: 'mil',
  },
  gate: {
    name: 'Gate', desc: 'Lets your own and allied units pass through walls.', size: 1, hp: 1500, cost: { stone: 30 }, time: 20, age: 1,
    armor: { m: 6, p: 6 }, los: 3, gate: true, menu: 'mil',
  },
};

// Age-up requirement pools
const AGE_REQ = {
  1: { from: ['barracks', 'mill', 'lumbercamp', 'miningcamp'], count: 2 },
  2: { from: ['archeryrange', 'stable', 'blacksmith', 'market'], count: 2 },
  3: { from: ['siegeworkshop', 'university', 'monastery', 'castle', 'castle'], count: 2 },
};

// ---------------------------------------------------------------- tech helpers
// These operate on Player instances (see entities.js for Player.forStats etc.)
const isInf = s => s.classes.includes('infantry');
const isCav = s => s.classes.includes('cavalry');
const isArch = s => s.classes.includes('archer');
const isFootArch = s => s.classes.includes('footarcher');
const isMeleeMil = s => (isInf(s) || isCav(s)) && !isArch(s) && s.atk > 0;
const isVill = s => s.classes.includes('villager');

function techAtk(p, pred, n) { p.forStats(pred, s => { s.atk += n; }); }
function techArmor(p, pred, m, pi) { p.forStats(pred, s => { s.armor.m += m; s.armor.p += pi; }); }

// ---------------------------------------------------------------- technologies
const TECHS = {
  // ---------- ages
  feudal: { name: 'Feudal Age', at: 'towncenter', age: 0, cost: { food: 500 }, time: 130, ageUp: 1, icon: 'age1',
    desc: 'Advance to the Feudal Age. Unlocks archery ranges, stables, blacksmiths and markets.' },
  castle: { name: 'Castle Age', at: 'towncenter', age: 1, cost: { food: 800, gold: 200 }, time: 160, ageUp: 2, icon: 'age2',
    desc: 'Advance to the Castle Age. Unlocks castles, siege, monks and unique units.' },
  imperial: { name: 'Imperial Age', at: 'towncenter', age: 2, cost: { food: 1000, gold: 800 }, time: 190, ageUp: 3, icon: 'age3',
    desc: 'Advance to the Imperial Age. Unlocks the strongest units, upgrades and the Wonder.' },
  // ---------- town center
  loom: { name: 'Loom', at: 'towncenter', age: 0, cost: { gold: 50 }, time: 25, icon: 'loom',
    desc: 'Villagers +15 HP, +1/+2 armor.',
    effect: p => { p.forStats(isVill, s => { s.armor.m += 1; s.armor.p += 2; }); p.addMaxHp(isVill, 15); } },
  wheelbarrow: { name: 'Wheelbarrow', at: 'towncenter', age: 1, cost: { food: 175, wood: 50 }, time: 75, icon: 'wheel',
    desc: 'Villagers move 10% faster and carry 25% more.',
    effect: p => { p.forStats(isVill, s => { s.speed *= 1.1; }); p.mods.carry += 3; } },
  handcart: { name: 'Hand Cart', at: 'towncenter', age: 2, cost: { food: 300, wood: 200 }, time: 55, req: 'wheelbarrow', icon: 'cart',
    desc: 'Villagers move 10% faster and carry 50% more.',
    effect: p => { p.forStats(isVill, s => { s.speed *= 1.1; }); p.mods.carry += 7; } },
  townwatch: { name: 'Town Watch', at: 'towncenter', age: 1, cost: { food: 75 }, time: 25, icon: 'eye',
    desc: 'All buildings +4 line of sight.', effect: p => { p.mods.buildingLos += 4; } },
  // ---------- mill
  horsecollar: { name: 'Horse Collar', at: 'mill', age: 1, cost: { food: 75, wood: 75 }, time: 20, icon: 'collar',
    desc: 'Farms produce +75 food.', effect: p => { p.mods.farmFood += 75; } },
  heavyplow: { name: 'Heavy Plow', at: 'mill', age: 2, cost: { food: 125, wood: 125 }, time: 40, req: 'horsecollar', icon: 'plow',
    desc: 'Farms produce +125 food. Farmers carry +1 food.', effect: p => { p.mods.farmFood += 125; p.mods.farmCarry += 1; } },
  croprotation: { name: 'Crop Rotation', at: 'mill', age: 3, cost: { food: 250, wood: 250 }, time: 70, req: 'heavyplow', icon: 'crop',
    desc: 'Farms produce +175 food.', effect: p => { p.mods.farmFood += 175; } },
  // ---------- lumber camp
  doublebitaxe: { name: 'Double-Bit Axe', at: 'lumbercamp', age: 0, cost: { food: 100, wood: 50 }, time: 25, icon: 'axe',
    desc: 'Lumberjacks work 20% faster.', effect: p => { p.mods.gather.wood *= 1.2; } },
  bowsaw: { name: 'Bow Saw', at: 'lumbercamp', age: 1, cost: { food: 150, wood: 100 }, time: 50, req: 'doublebitaxe', icon: 'saw',
    desc: 'Lumberjacks work 20% faster.', effect: p => { p.mods.gather.wood *= 1.2; } },
  twomansaw: { name: 'Two-Man Saw', at: 'lumbercamp', age: 3, cost: { food: 300, wood: 200 }, time: 100, req: 'bowsaw', icon: 'saw2',
    desc: 'Lumberjacks work 10% faster.', effect: p => { p.mods.gather.wood *= 1.1; } },
  // ---------- mining camp
  goldmining: { name: 'Gold Mining', at: 'miningcamp', age: 1, cost: { food: 100, wood: 75 }, time: 30, icon: 'goldpick',
    desc: 'Gold miners work 15% faster.', effect: p => { p.mods.gather.gold *= 1.15; } },
  goldshaft: { name: 'Gold Shaft Mining', at: 'miningcamp', age: 2, cost: { food: 200, wood: 100 }, time: 75, req: 'goldmining', icon: 'goldpick2',
    desc: 'Gold miners work 15% faster.', effect: p => { p.mods.gather.gold *= 1.15; } },
  stonemining: { name: 'Stone Mining', at: 'miningcamp', age: 1, cost: { food: 100, wood: 75 }, time: 30, icon: 'stonepick',
    desc: 'Stone miners work 15% faster.', effect: p => { p.mods.gather.stone *= 1.15; } },
  stoneshaft: { name: 'Stone Shaft Mining', at: 'miningcamp', age: 2, cost: { food: 200, wood: 100 }, time: 75, req: 'stonemining', icon: 'stonepick2',
    desc: 'Stone miners work 15% faster.', effect: p => { p.mods.gather.stone *= 1.15; } },
  // ---------- blacksmith
  forging: { name: 'Forging', at: 'blacksmith', age: 1, cost: { food: 150 }, time: 50, icon: 'sword1',
    desc: 'Infantry and cavalry +1 attack.', effect: p => techAtk(p, isMeleeMil, 1) },
  ironcasting: { name: 'Iron Casting', at: 'blacksmith', age: 2, cost: { food: 220, gold: 120 }, time: 75, req: 'forging', icon: 'sword2',
    desc: 'Infantry and cavalry +1 attack.', effect: p => techAtk(p, isMeleeMil, 1) },
  blastfurnace: { name: 'Blast Furnace', at: 'blacksmith', age: 3, cost: { food: 275, gold: 225 }, time: 100, req: 'ironcasting', icon: 'sword3',
    desc: 'Infantry and cavalry +2 attack.', effect: p => techAtk(p, isMeleeMil, 2) },
  scalemail: { name: 'Scale Mail Armor', at: 'blacksmith', age: 1, cost: { food: 100 }, time: 40, icon: 'infarmor1',
    desc: 'Infantry +1/+1 armor.', effect: p => techArmor(p, isInf, 1, 1) },
  chainmail: { name: 'Chain Mail Armor', at: 'blacksmith', age: 2, cost: { food: 200, gold: 100 }, time: 55, req: 'scalemail', icon: 'infarmor2',
    desc: 'Infantry +1/+1 armor.', effect: p => techArmor(p, isInf, 1, 1) },
  platemail: { name: 'Plate Mail Armor', at: 'blacksmith', age: 3, cost: { food: 300, gold: 150 }, time: 70, req: 'chainmail', icon: 'infarmor3',
    desc: 'Infantry +1/+2 armor.', effect: p => techArmor(p, isInf, 1, 2) },
  scalebarding: { name: 'Scale Barding Armor', at: 'blacksmith', age: 1, cost: { food: 150 }, time: 45, icon: 'cavarmor1',
    desc: 'Cavalry +1/+1 armor.', effect: p => techArmor(p, isCav, 1, 1) },
  chainbarding: { name: 'Chain Barding Armor', at: 'blacksmith', age: 2, cost: { food: 250, gold: 150 }, time: 60, req: 'scalebarding', icon: 'cavarmor2',
    desc: 'Cavalry +1/+1 armor.', effect: p => techArmor(p, isCav, 1, 1) },
  platebarding: { name: 'Plate Barding Armor', at: 'blacksmith', age: 3, cost: { food: 350, gold: 200 }, time: 75, req: 'chainbarding', icon: 'cavarmor3',
    desc: 'Cavalry +1/+2 armor.', effect: p => techArmor(p, isCav, 1, 2) },
  fletching: { name: 'Fletching', at: 'blacksmith', age: 1, cost: { food: 100, gold: 50 }, time: 30, icon: 'arrow1',
    desc: 'Archers, Town Centers and towers +1 attack and +1 range.',
    effect: p => { p.forStats(isArch, s => { s.atk += 1; s.range += 1; s.los += 1; }); p.mods.towerAtk += 1; p.mods.towerRange += 1; } },
  bodkinarrow: { name: 'Bodkin Arrow', at: 'blacksmith', age: 2, cost: { food: 200, gold: 100 }, time: 35, req: 'fletching', icon: 'arrow2',
    desc: 'Archers, Town Centers and towers +1 attack and +1 range.',
    effect: p => { p.forStats(isArch, s => { s.atk += 1; s.range += 1; s.los += 1; }); p.mods.towerAtk += 1; p.mods.towerRange += 1; } },
  bracer: { name: 'Bracer', at: 'blacksmith', age: 3, cost: { food: 300, gold: 200 }, time: 40, req: 'bodkinarrow', icon: 'arrow3',
    desc: 'Archers, Town Centers and towers +1 attack and +1 range.',
    effect: p => { p.forStats(isArch, s => { s.atk += 1; s.range += 1; s.los += 1; }); p.mods.towerAtk += 1; p.mods.towerRange += 1; } },
  paddedarcher: { name: 'Padded Archer Armor', at: 'blacksmith', age: 1, cost: { food: 100 }, time: 40, icon: 'archarmor1',
    desc: 'Archers +1/+1 armor.', effect: p => techArmor(p, isArch, 1, 1) },
  leatherarcher: { name: 'Leather Archer Armor', at: 'blacksmith', age: 2, cost: { food: 150, gold: 150 }, time: 55, req: 'paddedarcher', icon: 'archarmor2',
    desc: 'Archers +1/+1 armor.', effect: p => techArmor(p, isArch, 1, 1) },
  ringarcher: { name: 'Ring Archer Armor', at: 'blacksmith', age: 3, cost: { food: 250, gold: 250 }, time: 70, req: 'leatherarcher', icon: 'archarmor3',
    desc: 'Archers +1/+2 armor.', effect: p => techArmor(p, isArch, 1, 2) },
  // ---------- barracks
  up_manatarms: { name: 'Man-at-Arms', at: 'barracks', age: 1, cost: { food: 100, gold: 40 }, time: 40, upgrade: ['militia', 'manatarms'], icon: 'U:manatarms',
    desc: 'Upgrade Militia to Man-at-Arms.' },
  up_longsword: { name: 'Long Swordsman', at: 'barracks', age: 2, cost: { food: 200, gold: 65 }, time: 45, upgrade: ['manatarms', 'longswordsman'], req: 'up_manatarms', icon: 'U:longswordsman',
    desc: 'Upgrade Men-at-Arms to Long Swordsmen.' },
  up_champion: { name: 'Champion', at: 'barracks', age: 3, cost: { food: 750, gold: 350 }, time: 100, upgrade: ['longswordsman', 'champion'], req: 'up_longsword', icon: 'U:champion',
    desc: 'Upgrade Long Swordsmen to Champions.' },
  up_pikeman: { name: 'Pikeman', at: 'barracks', age: 2, cost: { food: 215, gold: 90 }, time: 45, upgrade: ['spearman', 'pikeman'], icon: 'U:pikeman',
    desc: 'Upgrade Spearmen to Pikemen.' },
  up_halberdier: { name: 'Halberdier', at: 'barracks', age: 3, cost: { food: 300, gold: 600 }, time: 50, upgrade: ['pikeman', 'halberdier'], req: 'up_pikeman', icon: 'U:halberdier',
    desc: 'Upgrade Pikemen to Halberdiers.' },
  squires: { name: 'Squires', at: 'barracks', age: 2, cost: { food: 100 }, time: 40, icon: 'boot',
    desc: 'Infantry move 10% faster.', effect: p => p.forStats(isInf, s => { s.speed *= 1.1; }) },
  // ---------- archery range
  up_crossbow: { name: 'Crossbowman', at: 'archeryrange', age: 2, cost: { food: 125, gold: 75 }, time: 35, upgrade: ['archer', 'crossbowman'], icon: 'U:crossbowman',
    desc: 'Upgrade Archers to Crossbowmen.' },
  up_arbalester: { name: 'Arbalester', at: 'archeryrange', age: 3, cost: { food: 350, gold: 300 }, time: 50, upgrade: ['crossbowman', 'arbalester'], req: 'up_crossbow', icon: 'U:arbalester',
    desc: 'Upgrade Crossbowmen to Arbalesters.' },
  up_eliteskirm: { name: 'Elite Skirmisher', at: 'archeryrange', age: 2, cost: { wood: 200, gold: 100 }, time: 50, upgrade: ['skirmisher', 'eliteskirmisher'], icon: 'U:eliteskirmisher',
    desc: 'Upgrade Skirmishers to Elite Skirmishers.' },
  up_heavycavarcher: { name: 'Heavy Cav Archer', at: 'archeryrange', age: 3, cost: { food: 900, gold: 500 }, time: 50, upgrade: ['cavalryarcher', 'heavycavalryarcher'], icon: 'U:heavycavalryarcher',
    desc: 'Upgrade Cavalry Archers to Heavy Cavalry Archers.' },
  thumbring: { name: 'Thumb Ring', at: 'archeryrange', age: 2, cost: { food: 300, wood: 250 }, time: 45, icon: 'ring',
    desc: 'Archers fire 15% faster and are perfectly accurate.',
    effect: p => p.forStats(isArch, s => { s.reload /= 1.15; s.accuracy = 1; }) },
  // ---------- stable
  up_lightcav: { name: 'Light Cavalry', at: 'stable', age: 2, cost: { food: 150, gold: 50 }, time: 45, upgrade: ['scoutcavalry', 'lightcavalry'], icon: 'U:lightcavalry',
    desc: 'Upgrade Scout Cavalry to Light Cavalry.' },
  up_hussar: { name: 'Hussar', at: 'stable', age: 3, cost: { food: 500, gold: 600 }, time: 50, upgrade: ['lightcavalry', 'hussar'], req: 'up_lightcav', icon: 'U:hussar',
    desc: 'Upgrade Light Cavalry to Hussars.' },
  up_cavalier: { name: 'Cavalier', at: 'stable', age: 3, cost: { food: 300, gold: 300 }, time: 100, upgrade: ['knight', 'cavalier'], icon: 'U:cavalier',
    desc: 'Upgrade Knights to Cavaliers.' },
  up_paladin: { name: 'Paladin', at: 'stable', age: 3, cost: { food: 1300, gold: 750 }, time: 170, upgrade: ['cavalier', 'paladin'], req: 'up_cavalier', icon: 'U:paladin',
    desc: 'Upgrade Cavaliers to Paladins.' },
  bloodlines: { name: 'Bloodlines', at: 'stable', age: 1, cost: { food: 150, gold: 100 }, time: 50, icon: 'horse',
    desc: 'Mounted units +20 HP.', effect: p => p.addMaxHp(isCav, 20) },
  husbandry: { name: 'Husbandry', at: 'stable', age: 2, cost: { food: 150 }, time: 50, icon: 'horseshoe',
    desc: 'Mounted units move 10% faster.', effect: p => p.forStats(isCav, s => { s.speed *= 1.1; }) },
  // ---------- siege workshop
  up_onager: { name: 'Onager', at: 'siegeworkshop', age: 3, cost: { food: 800, gold: 500 }, time: 75, upgrade: ['mangonel', 'onager'], icon: 'U:onager',
    desc: 'Upgrade Mangonels to Onagers.' },
  up_cappedram: { name: 'Capped Ram', at: 'siegeworkshop', age: 3, cost: { food: 300 }, time: 50, upgrade: ['batteringram', 'cappedram'], icon: 'U:cappedram',
    desc: 'Upgrade Battering Rams to Capped Rams.' },
  // ---------- university
  masonry: { name: 'Masonry', at: 'university', age: 2, cost: { wood: 175, stone: 150 }, time: 50, icon: 'brick',
    desc: 'Buildings +10% HP, +1/+1 armor.', effect: p => { p.mods.buildingHp *= 1.1; p.applyBuildingHp(1.1); p.mods.buildingArmor += 1; } },
  architecture: { name: 'Architecture', at: 'university', age: 3, cost: { wood: 200, stone: 300 }, time: 70, req: 'masonry', icon: 'brick2',
    desc: 'Buildings +10% HP, +1/+1 armor.', effect: p => { p.mods.buildingHp *= 1.1; p.applyBuildingHp(1.1); p.mods.buildingArmor += 1; } },
  treadmillcrane: { name: 'Treadmill Crane', at: 'university', age: 2, cost: { wood: 200, stone: 300 }, time: 40, icon: 'crane',
    desc: 'Villagers construct buildings 20% faster.', effect: p => { p.mods.buildRate *= 1.2; } },
  ballistics: { name: 'Ballistics', at: 'university', age: 2, cost: { wood: 300, gold: 175 }, time: 60, icon: 'target',
    desc: 'Archers, towers and castles lead their targets — far fewer missed shots on moving units.', effect: p => { p.mods.ballistics = true; } },
  guardtower: { name: 'Guard Tower', at: 'university', age: 2, cost: { food: 100, wood: 250 }, time: 30, icon: 'tower2',
    desc: 'Watch Towers become Guard Towers: +500 HP, +1 attack.', effect: p => { p.mods.towerHp += 500; p.mods.towerAtkT += 1; p.applyTowerHp(500); } },
  keep: { name: 'Keep', at: 'university', age: 3, cost: { food: 500, wood: 350 }, time: 75, req: 'guardtower', icon: 'tower3',
    desc: 'Guard Towers become Keeps: +700 HP, +2 attack.', effect: p => { p.mods.towerHp += 700; p.mods.towerAtkT += 2; p.applyTowerHp(700); } },
  chemistry: { name: 'Chemistry', at: 'university', age: 3, cost: { food: 300, gold: 200 }, time: 100, icon: 'flask',
    desc: 'Missile units and buildings +1 attack.', effect: p => { techAtk(p, s => !!s.proj, 1); p.mods.towerAtk += 1; } },
  siegeengineers: { name: 'Siege Engineers', at: 'university', age: 3, cost: { food: 500, wood: 600 }, time: 45, icon: 'gear',
    desc: 'Siege weapons +1 range and +20% damage vs buildings.',
    effect: p => p.forStats(s => s.classes.includes('siege'), s => { if (s.range > 0) { s.range += 1; s.los += 1; } if (s.bonus && s.bonus.building) s.bonus.building = Math.round(s.bonus.building * 1.2); }) },
  // ---------- monastery
  sanctity: { name: 'Sanctity', at: 'monastery', age: 2, cost: { gold: 120 }, time: 60, icon: 'cross',
    desc: 'Monks +15 HP.', effect: p => p.addMaxHp(s => s.classes.includes('monk'), 15) },
  fervor: { name: 'Fervor', at: 'monastery', age: 2, cost: { gold: 140 }, time: 50, icon: 'boot',
    desc: 'Monks move 15% faster.', effect: p => p.forStats(s => s.classes.includes('monk'), s => { s.speed *= 1.15; }) },
  // ---------- castle: elite unique units and unique techs
  up_elitelongbow: { name: 'Elite Longbowman', at: 'castle', age: 3, civ: 'britons', cost: { food: 850, gold: 850 }, time: 60, upgrade: ['longbowman', 'elitelongbowman'], icon: 'U:elitelongbowman', desc: 'Upgrade Longbowmen to Elite Longbowmen.' },
  up_eliteaxe: { name: 'Elite Throwing Axeman', at: 'castle', age: 3, civ: 'franks', cost: { food: 1000, gold: 850 }, time: 60, upgrade: ['throwingaxeman', 'elitethrowingaxeman'], icon: 'U:elitethrowingaxeman', desc: 'Upgrade Throwing Axemen.' },
  up_elitemangudai: { name: 'Elite Mangudai', at: 'castle', age: 3, civ: 'mongols', cost: { food: 1100, gold: 675 }, time: 60, upgrade: ['mangudai', 'elitemangudai'], icon: 'U:elitemangudai', desc: 'Upgrade Mangudai.' },
  up_elitecataphract: { name: 'Elite Cataphract', at: 'castle', age: 3, civ: 'byzantines', cost: { food: 1600, gold: 800 }, time: 60, upgrade: ['cataphract', 'elitecataphract'], icon: 'U:elitecataphract', desc: 'Upgrade Cataphracts.' },
  yeomen: { name: 'Yeomen', at: 'castle', age: 2, civ: 'britons', cost: { food: 750, wood: 450 }, time: 60, icon: 'arrowup',
    desc: 'Foot archers +1 range; towers +2 attack.', effect: p => { p.forStats(isFootArch, s => { s.range += 1; s.los += 1; }); p.mods.towerAtkT += 2; } },
  chivalry: { name: 'Chivalry', at: 'castle', age: 2, civ: 'franks', cost: { food: 400, wood: 400 }, time: 40, icon: 'horse',
    desc: 'Stables work 40% faster.', effect: p => { p.mods.trainSpeed.stable = (p.mods.trainSpeed.stable || 1) * 1.4; } },
  drill: { name: 'Drill', at: 'castle', age: 2, civ: 'mongols', cost: { food: 200, gold: 300 }, time: 60, icon: 'wheel',
    desc: 'Siege weapons move 50% faster.', effect: p => p.forStats(s => s.classes.includes('siege'), s => { s.speed *= 1.5; }) },
  logistica: { name: 'Logistica', at: 'castle', age: 2, civ: 'byzantines', cost: { food: 800, gold: 450 }, time: 50, icon: 'mace',
    desc: 'Cataphracts deal trample damage to nearby enemies and +6 attack vs infantry.',
    effect: p => p.forStats(s => s.line === 'cataphract', s => { s.trample = 0.5; s.bonus.infantry += 6; }) },
};

// ---------------------------------------------------------------- civilizations
const CIVS = {
  britons: {
    name: 'Britons', style: 'west', unique: 'longbowman', uniqueTech: 'yeomen', crest: 'lion',
    color: '#b23a3a', tagline: 'Archer civilization',
    bonuses: ['Foot archers +1 range in Castle Age, +1 more in Imperial Age', 'Shepherds work 25% faster',
      'Archery Ranges work 20% faster', 'Town Centers cost 50% less wood from Castle Age',
      'Unique unit: Longbowman — archer with exceptional range'],
    apply(p) {
      p.mods.gather.sheep *= 1.25;
      p.mods.trainSpeed.archeryrange = 1.2;
      p.onAge.push((age) => {
        if (age >= 2) p.forStats(isFootArch, s => { s.range += 1; s.los += 1; });
        if (age === 2) p.mods.costMult.towncenter = { wood: 0.5 };
      });
    },
  },
  franks: {
    name: 'Franks', style: 'west2', unique: 'throwingaxeman', uniqueTech: 'chivalry', crest: 'lily',
    color: '#3a5fb2', tagline: 'Cavalry civilization',
    bonuses: ['Cavalry +20% HP', 'Foragers work 15% faster', 'Farm upgrades are free',
      'Castles cost 25% less', 'Unique unit: Throwing Axeman — infantry that hurls axes'],
    apply(p) {
      p.forStats(isCav, s => { s.hp = Math.round(s.hp * 1.2); });
      p.mods.gather.forage *= 1.15;
      p.mods.techCostMult.horsecollar = 0; p.mods.techCostMult.heavyplow = 0; p.mods.techCostMult.croprotation = 0;
      p.mods.costMult.castle = { stone: 0.75 };
    },
  },
  mongols: {
    name: 'Mongols', style: 'steppe', unique: 'mangudai', uniqueTech: 'drill', crest: 'horse',
    color: '#3a8a5a', tagline: 'Cavalry archer civilization',
    bonuses: ['Cavalry archers fire 25% faster', 'Light Cavalry line +30% HP', 'Hunters work 40% faster',
      'Scout Cavalry line +2 line of sight', 'Unique unit: Mangudai — horse archer that shreds siege'],
    apply(p) {
      p.forStats(s => isCav(s) && isArch(s), s => { s.reload /= 1.25; });
      p.forStats(s => s.line === 'scoutcavalry' && s.age >= 2, s => { s.hp = Math.round(s.hp * 1.3); });
      p.forStats(s => s.line === 'scoutcavalry', s => { s.los += 2; });
      p.mods.gather.hunt *= 1.4;
    },
  },
  byzantines: {
    name: 'Byzantines', style: 'byz', unique: 'cataphract', uniqueTech: 'logistica', crest: 'eagle',
    color: '#8a3ab2', tagline: 'Defensive civilization',
    bonuses: ['Spearmen and Skirmishers cost 25% less', 'Buildings +10% HP per age after Dark Age',
      'Imperial Age costs 33% less', 'Unique unit: Cataphract — heavy cavalry that crushes infantry'],
    apply(p) {
      for (const t of ['spearman', 'pikeman', 'halberdier', 'skirmisher', 'eliteskirmisher']) p.mods.costMult[t] = { all: 0.75 };
      p.mods.techCostMult.imperial = 0.67;
      p.onAge.push(() => { p.mods.buildingHp *= 1.1; p.applyBuildingHp(1.1); });
    },
  },
};
const CIV_IDS = Object.keys(CIVS);

// ---------------------------------------------------------------- maps
const MAPS = {
  arabia:        { name: 'Arabia', desc: 'Open, rolling dry grassland with scattered woods. Little room to hide — expect early aggression.', base: 'dirt' },
  blackforest:   { name: 'Black Forest', desc: 'A vast, dense forest broken by narrow paths. Wood is endless; walls are easy.', base: 'grass' },
  oasis:         { name: 'Oasis', desc: 'Desert ringed around a central oasis lake. All the timber grows in the middle.', base: 'sand' },
  rivers:        { name: 'Rivers', desc: 'Lush meadows divided by deep rivers. Cross only at the shallow fords.', base: 'grass' },
  mediterranean: { name: 'Mediterranean', desc: 'A great inland sea fills the center; armies must march the long way around the coast.', base: 'grass' },
  frozennorth:   { name: 'Frozen North', desc: 'Snowfields, pine forests and frozen lakes you can walk across. Beware the wolves.', base: 'snow' },
};
const MAP_SIZES = {
  tiny:   { name: 'Tiny (2 players)', n: 80 },
  small:  { name: 'Small (3 players)', n: 100 },
  medium: { name: 'Medium (4 players)', n: 120 },
  large:  { name: 'Large (6 players)', n: 144 },
};

// Hotkey grid used by the command panel (5 columns x 3 rows)
const GRID_KEYS = ['Q', 'W', 'E', 'R', 'T', 'A', 'S', 'D', 'F', 'G', 'Z', 'X', 'C', 'V', 'B'];

// Villager jobs: displayed name and the length of one work cycle (seconds).
// The impact of each swing happens at WORK_HIT of the cycle, where the sound plays.
const VILLAGER_ROLES = { wood: 'Lumberjack', gold: 'Gold Miner', stone: 'Stone Miner', farm: 'Farmer', forage: 'Forager', hunt: 'Hunter', sheep: 'Shepherd', build: 'Builder', repair: 'Repairer' };
const WORK_CYCLE = { wood: 1.0, gold: 1.05, stone: 1.05, farm: 1.3, build: 0.8, forage: 1.2, hunt: 1.0, sheep: 1.0 };
const WORK_FRAMES = 8, WORK_HIT = 6 / 8;
