// Built-in fixture taste-graph data — served when QLOO_API_KEY is empty/unreachable.
// mode:'fixture' lets the UI render the full evidence trail with a demo-data note.

export const FIXTURE_ENTITIES = {
  'urn:entity:artist': [
    'Khruangbin', 'Erykah Badu', 'Tame Impala', 'Nils Frahm', 'BADBADNOTGOOD',
    'Yussef Dayes', 'Anderson .Paak', 'Bonobo', 'SZA', 'Fleet Foxes',
    'Tom Misch', 'Hiatus Kaiyote',
  ],
  'urn:entity:brand': [
    'Patagonia', 'Blue Bottle Coffee', 'Aesop', 'MUJI', 'Everlane',
    'Allbirds', 'A24', 'Le Creuset', 'Kinfolk', 'Outdoor Voices',
    'Oatly', 'Reformation',
  ],
  'urn:entity:movie': [
    'Everything Everywhere All at Once', 'Moonlight', 'Spirited Away',
    'The Grand Budapest Hotel', 'Lady Bird', 'Dune', 'Amelie',
    'Parasite', 'The Before Trilogy', 'Past Lives',
  ],
  'urn:entity:tv': [
    'Chef\u2019s Table', 'Abstract: The Art of Design', 'The Bear',
    'Atlanta', 'Planet Earth II', 'Severance', 'The Great British Bake Off',
    'Ted Lasso', 'Dark', 'Somebody Feed Phil',
  ],
  'urn:entity:place': [
    'Kyoto, Japan', 'Lisbon, Portugal', 'Copenhagen, Denmark',
    'Oaxaca, Mexico', 'Reykjavik, Iceland', 'Melbourne, Australia',
    'Big Sur, California', 'Marrakech, Morocco', 'Portland, Oregon',
    'Hoi An, Vietnam',
  ],
  'urn:entity:podcast': [
    '99% Invisible', 'How I Built This', 'The Tim Ferriss Show',
    'On Being', 'Song Exploder', 'Maintenance Phase', 'The Daily',
    'Armchair Expert', 'Design Matters', 'Acquired',
  ],
  'urn:entity:book': [
    'The Design of Everyday Things', 'Sapiens', 'The Creative Act',
    'Braiding Sweetgrass', 'A Pattern Language', 'The Kinfolk Table',
    'Thinking, Fast and Slow', 'Salt Fat Acid Heat',
  ],
  'urn:entity:video-game': [
    'Stardew Valley', 'Zelda: Breath of the Wild', 'Journey',
    'Hades', 'Animal Crossing', 'Gris',
  ],
  'urn:entity:person': [
    'Yotam Ottolenghi', 'David Attenborough', 'Iris Apfel',
    'Massimo Bottura', 'Maya Lin', 'Rick Rubin',
  ],
};

export const FIXTURE_TAGS = {
  coffee: ['craft coffee', 'third-wave coffee', 'slow mornings', 'cafe culture'],
  sustainable: ['sustainable fashion', 'eco-friendly living', 'ethical sourcing', 'zero waste'],
  minimal: ['minimalism', 'scandinavian design', 'japandi', 'decluttering'],
  artisan: ['artisan goods', 'handmade craft', 'small batch', 'makers movement'],
  wellness: ['mindfulness', 'yoga practice', 'holistic health', 'outdoor fitness'],
  food: ['farm to table', 'plant-based cooking', 'foodie culture', 'fermentation'],
  travel: ['slow travel', 'backpacking', 'cultural immersion', 'van life'],
  music: ['vinyl collecting', 'live music', 'indie music', 'jazz fusion'],
  design: ['graphic design', 'typography', 'interior design', 'brutalism'],
  outdoor: ['hiking', 'trail running', 'camping', 'surf culture'],
};

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// deterministic pseudo-affinity so different signals shuffle ranking but stay stable
function score(name, seed) {
  let h = 0;
  const s = name + '|' + seed;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return 0.55 + (h % 42) / 100; // 0.55 - 0.96
}

export function fixtureEntities(type, take = 8, seed = '') {
  const names = FIXTURE_ENTITIES[type] || FIXTURE_ENTITIES['urn:entity:brand'];
  return names
    .map((name) => ({
      id: `fixture:${type.replace('urn:entity:', '')}:${slug(name)}`,
      name,
      affinity: Number(score(name, seed).toFixed(2)),
      popularity: Number((0.3 + (score(name, seed + 'p') - 0.55) * 0.7).toFixed(2)),
      types: [type],
    }))
    .sort((a, b) => b.affinity - a.affinity)
    .slice(0, take);
}

export function fixtureSearch(query, take = 10) {
  const q = (query || '').toLowerCase();
  const all = [];
  for (const [type, names] of Object.entries(FIXTURE_ENTITIES)) {
    for (const name of names) {
      const match = !q || name.toLowerCase().includes(q) || q.split(/\s+/).some((w) => w.length > 2 && name.toLowerCase().includes(w));
      if (match) all.push({ id: `fixture:${type.replace('urn:entity:', '')}:${slug(name)}`, name, popularity: Number(score(name, 'pop').toFixed(2)), types: [type] });
    }
  }
  if (!all.length) {
    all.push({ id: `fixture:brand:${slug(query || 'unknown')}`, name: query || 'Unknown', popularity: 0.5, types: ['urn:entity:brand'] });
  }
  return all.slice(0, take);
}

export function fixtureTags(query, take = 8) {
  const q = (query || '').toLowerCase();
  const tags = [];
  for (const [k, arr] of Object.entries(FIXTURE_TAGS)) {
    if (k.includes(q) || q.includes(k) || !q) for (const t of arr) tags.push(t);
    else for (const t of arr) if (t.includes(q)) tags.push(t);
  }
  if (!tags.length && q) tags.push(`${q} enthusiasts`, `${q} lifestyle`, `modern ${q}`);
  return tags.slice(0, take).map((name) => ({ id: `fixture:tag:${slug(name)}`, name, types: ['urn:tag:keyword'] }));
}
