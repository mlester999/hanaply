export const motionTokens = {
  duration: { micro: 0.2, interface: 0.38, reveal: 0.58, story: 0.9 },
  ease: [0.22, 1, 0.36, 1] as const,
  viewport: { once: true, amount: 0.18 },
};

export const reveal = {
  initial: false as const,
  whileInView: { opacity: 1, y: 0 },
  viewport: motionTokens.viewport,
  transition: { duration: motionTokens.duration.reveal, ease: motionTokens.ease },
};
