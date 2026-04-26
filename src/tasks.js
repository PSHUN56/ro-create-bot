const DAILY_TASKS = [
  {
    id: "ui-concept",
    title: "Концепт интерфейса",
    description: "Сделай скриншот или короткое видео UI-концепта для Roblox Studio и коротко объясни идею.",
    reward: 350
  },
  {
    id: "builder-showcase",
    title: "Витрина билда",
    description: "Покажи часть своей карты, локации или модели и напиши, что именно ты собрал или улучшил.",
    reward: 400
  },
  {
    id: "scripting-tip",
    title: "Совет по скриптингу",
    description: "Поделись скриншотом или видео механики и поясни, какую задачу решает твой скрипт.",
    reward: 450
  },
  {
    id: "helper-task",
    title: "Помощь участнику",
    description: "Помоги кому-то на сервере по Roblox Studio и приложи медиа с коротким комментарием, в чем была помощь.",
    reward: 425
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
