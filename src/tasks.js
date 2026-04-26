const DAILY_TASKS = [
  {
    id: "ui-concept",
    title: "Концепт интерфейса",
    description: "Сделай скриншот UI-концепта для Roblox Studio или Figma-макета игрового интерфейса.",
    reward: 350
  },
  {
    id: "builder-showcase",
    title: "Витрина билда",
    description: "Покажи часть своей карты, локации или модели и коротко объясни, что именно ты сделал.",
    reward: 400
  },
  {
    id: "scripting-tip",
    title: "Совет по скриптингу",
    description: "Поделись скриншотом кода или результата механики и поясни, какую задачу решает скрипт.",
    reward: 450
  },
  {
    id: "animation-pass",
    title: "Анимационный апдейт",
    description: "Прикрепи превью анимации персонажа или объекта и добавь 1-2 предложения о прогрессе.",
    reward: 375
  }
];

function getTaskForDate(date = new Date()) {
  const utcDay = Math.floor(date.getTime() / 86400000);
  return DAILY_TASKS[utcDay % DAILY_TASKS.length];
}

module.exports = {
  DAILY_TASKS,
  getTaskForDate
};
