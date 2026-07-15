(async () => {
  await HR.loadJudges();
  const el = document.getElementById("marquee");
  if (el) HR.buildMarquee(el);
})();
