export const PODCAST_FORMATS = [
  {key: 'solo', name: 'Solo', capacity: '1 person · 1 camera', people: 1, amounts: [150, 250, 350]},
  {key: 'interview', name: 'Interview', capacity: '2 people · 2 cameras', people: 2, amounts: [199, 349, 399]},
  {key: 'panel', name: 'Panel', capacity: '4 people · 3 cameras', people: 4, amounts: [249, 399, 449]},
  {key: 'premium', name: 'Premium', capacity: null, people: null, amounts: [299, 449, 499]},
] as const;

export const PODCAST_HOURS = [1, 2, 3] as const;
export const podcastPlanSlug = (key: string, hours: number) => `podcast-${key}-${['starter', 'standard', 'production'][hours - 1]}`;
