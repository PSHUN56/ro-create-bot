const DIRECTIONS = [
  {
    tag: "ui",
    titles: ["Концепт интерфейса", "Редизайн панели", "Мини UI-апдейт"],
    prompt: "Покажи скриншот или видео интерфейса для Roblox Studio и коротко объясни, что именно ты улучшил.",
    reward: [320, 420]
  },
  {
    tag: "build",
    titles: ["Витрина билда", "Апдейт локации", "Мини-сцена"],
    prompt: "Покажи часть своей карты, комнаты, модели или окружения и напиши, что именно ты собрал или доработал.",
    reward: [350, 450]
  },
  {
    tag: "script",
    titles: ["Совет по скриптингу", "Механика дня", "Полезный Lua-фрагмент"],
    prompt: "Покажи механику, скрипт или результат работы системы и поясни, какую задачу это решает.",
    reward: [360, 470]
  },
  {
    tag: "help",
    titles: ["Помощь участнику", "Разбор проблемы", "Подсказка новичку"],
    prompt: "Помоги кому-то на сервере с Roblox Studio и приложи медиа с коротким комментарием, в чем именно была помощь.",
    reward: [340, 430]
  }
];

const EXTRAS = [
  "Если хочешь, добавь 1-2 предложения о том, что было самым сложным.",
  "Можно приложить как скриншот, так и короткое видео.",
  "Лучше показать не только итог, но и сам процесс или важный фрагмент.",
  "Если это помощь участнику, коротко опиши, какой был вопрос и как ты его решил."
];

function createSeed(date = new Date()) {
  return Math.floor(date.getTime() / 86400000);
}

function pick(list, seed, offset = 0) {
  return list[(seed + offset) % list.length];
}

function getTaskForDate(date = new Date()) {
  const seed = createSeed(date);
  const direction = pick(DIRECTIONS, seed);
  const title = pick(direction.titles, seed, 1);
  const extra = pick(EXTRAS, seed, 2);
  const minReward = direction.reward[0];
  const maxReward = direction.reward[1];
  const reward = minReward + ((seed * 17) % (maxReward - minReward + 1));

  return {
    id: `${direction.tag}-${seed}`,
    title,
    description: `${direction.prompt} ${extra}`,
    reward
  };
}

module.exports = {
  getTaskForDate
};
