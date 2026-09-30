// Central store for generated cinematic imagery (media.base44.com URLs).
export const CINE_IMAGES = {
  heroBackdrop: 'https://media.base44.com/images/public/6a73619e5499baa21f415b49/73d69f144_generated_image.png',
  friends: 'https://media.base44.com/images/public/6a73619e5499baa21f415b49/b52dd7d12_generated_image.png',
  modernFamily: 'https://media.base44.com/images/public/6a73619e5499baa21f415b49/e5032c6b7_generated_image.png',
  hogwarts: 'https://media.base44.com/images/public/6a73619e5499baa21f415b49/71185c826_generated_image.png',
  epic: 'https://media.base44.com/images/public/6a73619e5499baa21f415b49/e46849927_generated_image.png',
  indie: 'https://media.base44.com/images/public/6a73619e5499baa21f415b49/bb78d6a7c_generated_image.png',
};

export const POSTER_BY_CATEGORY = {
  series: CINE_IMAGES.friends,
  film: CINE_IMAGES.indie,
  animation: CINE_IMAGES.hogwarts,
  indie: CINE_IMAGES.indie,
};