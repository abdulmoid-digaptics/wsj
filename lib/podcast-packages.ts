/** Podcast packages: original names and descriptions, fixed-duration totals. */
const STANDARD = 'Two-hour standard podcast session with camera production, studio lighting and raw files included.';
const PRODUCTION = 'Three-hour premium production with audio enhancement, an edited episode and social clips.';
export const PODCAST_FORMATS = [
  {key: 'solo', name: 'Solo Creator Studio', capacity: '1 person · 1 camera', people: 1, amounts: [150, 250, 350], starter: 'Starter podcast session for solo creators and short-form recordings.'},
  {key: 'interview', name: 'Interview Studio', capacity: '2 people · 2 cameras', people: 2, amounts: [199, 349, 399], starter: 'Starter podcast session set up for host and guest interviews.'},
  {key: 'panel', name: 'Panel Podcast Studio', capacity: '4 people · 3 cameras', people: 4, amounts: [249, 399, 449], starter: 'Starter podcast session for panel and roundtable formats.'},
  {key: 'premium', name: 'Premium Video Podcast Studio', capacity: null, people: null, amounts: [299, 449, 499], starter: 'Starter podcast session in our flagship multi-camera video studio.'},
] as const;

export const PODCAST_HOURS = [1, 2, 3] as const;
export const podcastPlanSlug = (key: string, hours: number) => `podcast-${key}-${['starter', 'standard', 'production'][hours - 1]}`;
type Format = (typeof PODCAST_FORMATS)[number];
export const podcastPlanName = (f: Format, hours: number) => [f.name, f.name + ' — Standard Session', f.name + ' — Premium Production'][hours - 1];
export const podcastPlanDescription = (f: Format, hours: number) => [f.starter, STANDARD, PRODUCTION][hours - 1];
