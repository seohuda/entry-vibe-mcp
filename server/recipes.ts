/**
 * Keyword → recipe matching for get_build_guide.
 * No LLM — pure heuristics so the host agent gets a concrete starting IR shape.
 */

export interface BuildRecipe {
  id: string;
  title: string;
  /** Substrings matched against the lowercased Korean/English request. */
  keywords: string[];
  recommendedBlocks: string[];
  notes: string[];
  /** Compact IR sketch the host should flesh out with get_block_schema. */
  irSketch: Record<string, unknown>;
}

export const BUILD_RECIPES: BuildRecipe[] = [
  {
    id: 'bounce-loop',
    title: '반복 이동 + 벽 튕기기',
    keywords: ['튕기', 'bounce', '반복', '움직', '이동', 'walk', 'move'],
    recommendedBlocks: [
      'when_run_button_click',
      'repeat_basic',
      'move_direction',
      'bounce_wall',
    ],
    notes: [
      'repeat_basic의 VALUE는 횟수, DO 슬롯에 move_direction + bounce_wall을 넣습니다.',
      'search_blocks는 기본 scope=core를 쓰세요.',
    ],
    irSketch: {
      objects: [
        {
          name: '고양이',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              {
                type: 'repeat_basic',
                params: { VALUE: 4 },
                statements: {
                  DO: [
                    { type: 'move_direction', params: { VALUE: 10 } },
                    { type: 'bounce_wall' },
                  ],
                },
              },
            ],
          ],
        },
      ],
    },
  },
  {
    id: 'score-counter',
    title: '변수(점수) 카운터',
    keywords: ['점수', '변수', '카운트', 'score', 'variable', '더하기'],
    recommendedBlocks: [
      'when_run_button_click',
      'set_variable',
      'change_variable',
      'show_variable',
    ],
    notes: [
      '변수를 ir.variables에 선언한 뒤 VARIABLE 파라미터에 이름을 넣습니다.',
      '컴파일러가 이름을 Entry 내부 id로 바꿉니다.',
    ],
    irSketch: {
      variables: [{ name: '점수', initialValue: 0 }],
      objects: [
        {
          name: '점수판',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'set_variable', params: { VARIABLE: '점수', VALUE: 0 } },
              { type: 'show_variable', params: { VARIABLE: '점수' } },
              { type: 'change_variable', params: { VARIABLE: '점수', VALUE: 1 } },
            ],
          ],
        },
      ],
    },
  },
  {
    id: 'todo-list',
    title: '리스트 다루기',
    keywords: ['리스트', '목록', 'todo', 'list', '추가'],
    recommendedBlocks: ['when_run_button_click', 'add_value_to_list', 'show_list'],
    notes: ['리스트는 ir.lists에 선언하고 LIST 파라미터에 이름을 사용합니다.'],
    irSketch: {
      lists: [{ name: '할일', initialValues: [] }],
      objects: [
        {
          name: '목록',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'add_value_to_list', params: { VALUE: '과제', LIST: '할일' } },
              { type: 'show_list', params: { LIST: '할일' } },
            ],
          ],
        },
      ],
    },
  },
  {
    id: 'message-ping',
    title: '신호(메시지) 보내기/받기',
    keywords: ['신호', '메시지', 'message', '보내', '받'],
    recommendedBlocks: ['when_run_button_click', 'message_cast', 'when_message_cast'],
    notes: [
      'ir.messages에 신호 이름을 선언합니다.',
      'message_cast / when_message_cast의 VALUE에 그 이름을 넣습니다 (MESSAGE 키가 아님).',
    ],
    irSketch: {
      messages: [{ name: '시작' }],
      objects: [
        {
          name: '송신',
          sprite: 'entrybot',
          x: -100,
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'message_cast', params: { VALUE: '시작' } },
            ],
          ],
        },
        {
          name: '수신',
          sprite: 'entrybot',
          x: 100,
          scripts: [
            [
              { type: 'when_message_cast', params: { VALUE: '시작' } },
              { type: 'move_direction', params: { VALUE: 10 } },
            ],
          ],
        },
      ],
    },
  },
  {
    id: 'function-call',
    title: '함수 정의 + 호출',
    keywords: ['함수', 'function', '호출', '재사용'],
    recommendedBlocks: ['when_run_button_click', 'function_call', 'move_direction'],
    notes: [
      '함수는 ir.functions에 name/type/body로 선언합니다 (object scripts에 function_create 금지).',
      '호출은 { "type": "function_call", "params": { "NAME": "함수이름" } }.',
    ],
    irSketch: {
      functions: [
        {
          name: '한 걸음',
          type: 'statement',
          body: [{ type: 'move_direction', params: { VALUE: 10 } }],
        },
      ],
      objects: [
        {
          name: '엔트리봇',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'function_call', params: { NAME: '한 걸음' } },
              { type: 'function_call', params: { NAME: '한 걸음' } },
            ],
          ],
        },
      ],
    },
  },
  {
    id: 'tts-read',
    title: 'AI 읽어주기 (TTS)',
    keywords: ['읽어', 'tts', '말하기', '음성'],
    recommendedBlocks: ['when_run_button_click', 'read_text'],
    notes: [
      'TTS는 AI 블록입니다. search_blocks(..., scope="ai")로 검색하세요.',
      '컴파일 시 aiUtilizeBlocks에 tts가 자동 추가됩니다.',
    ],
    irSketch: {
      objects: [
        {
          name: '안내',
          sprite: 'entrybot',
          scripts: [
            [
              { type: 'when_run_button_click' },
              { type: 'read_text', params: { TEXT: '안녕하세요' } },
            ],
          ],
        },
      ],
    },
  },
];

const WORKFLOW_STEPS = [
  'get_build_guide(request) — 레시피·추천 블록·IR 스케치 확인',
  'search_blocks(query, scope="core") — 기본은 core. AI면 scope="ai", 하드웨어면 scope="hardware"',
  'get_block_schema(types) — 정확한 params / statementKeys 확인',
  'validate_project(ir) — errors+hints를 보고 IR 수정 후 재검증',
  'compile_project(ir, filename?) — .ent 생성. 실패 시 hints로 수정 후 재시도',
] as const;

export function matchRecipes(request: string): BuildRecipe[] {
  const q = request.trim().toLowerCase();
  if (!q) return [];
  const scored = BUILD_RECIPES.map((recipe) => {
    let score = 0;
    for (const kw of recipe.keywords) {
      if (q.includes(kw.toLowerCase())) score += kw.length;
    }
    return { recipe, score };
  })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
  return scored.map((s) => s.recipe);
}

export function buildGuide(request: string) {
  const recipes = matchRecipes(request);
  const recommendedBlocks = [
    ...new Set(recipes.flatMap((r) => r.recommendedBlocks)),
  ];
  return {
    request,
    workflow: [...WORKFLOW_STEPS],
    scopeDefault: 'core' as const,
    matchedRecipes: recipes.map((r) => ({
      id: r.id,
      title: r.title,
      recommendedBlocks: r.recommendedBlocks,
      notes: r.notes,
      irSketch: r.irSketch,
    })),
    recommendedBlocks:
      recommendedBlocks.length > 0
        ? recommendedBlocks
        : ['when_run_button_click', 'move_direction', 'repeat_basic'],
    nextSteps: [
      recipes[0]
        ? `Start from matched recipe "${recipes[0].id}" irSketch, then get_block_schema on its blocks.`
        : 'No recipe matched — search_blocks for verbs in the request (이동, 반복, 변수, …) with scope=core.',
      'Never invent param keys. Always use get_block_schema.',
      'Call validate_project before compile_project. Apply hints on failure.',
    ],
  };
}
