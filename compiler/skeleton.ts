/**
 * Hardcoded Entry.getStartProject() skeleton (Korean labels).
 * Media paths use temp/ relative form suitable for .ent packing.
 */
export interface EntryProject {
  category: string;
  scenes: Array<{ name: string; id: string }>;
  variables: Array<Record<string, unknown>>;
  objects: Array<Record<string, unknown>>;
  expansionBlocks: string[];
  aiUtilizeBlocks: string[];
  speed: number;
  messages?: Array<{ id: string; name: string }>;
  functions?: unknown[];
  tables?: unknown[];
}

const MEDIA_PREFIX = 'temp/media/';

export function createStartProjectSkeleton(): EntryProject {
  return {
    category: '기타',
    scenes: [
      {
        name: '장면 1',
        id: '7dwq',
      },
    ],
    variables: [
      {
        name: '초시계',
        id: 'brih',
        visible: false,
        value: '0',
        variableType: 'timer',
        x: 134,
        y: -70,
        array: [],
        object: null,
        isCloud: false,
      },
      {
        name: '대답',
        id: '1vu8',
        visible: false,
        value: '0',
        variableType: 'answer',
        x: 150,
        y: -100,
        array: [],
        object: null,
        isCloud: false,
      },
    ],
    objects: [
      {
        id: '7y0y',
        name: '엔트리봇',
        label: {
          ko: '엔트리봇',
          en: 'Entrybot',
        },
        script: [
          [
            {
              type: 'when_run_button_click',
              x: 40,
              y: 50,
            },
            {
              type: 'repeat_basic',
              statements: [[{ type: 'move_direction' }]],
            },
          ],
        ],
        selectedPictureId: 'vx80',
        objectType: 'sprite',
        rotateMethod: 'free',
        scene: '7dwq',
        sprite: {
          sounds: [
            {
              duration: 1.3,
              ext: '.mp3',
              id: '8el5',
              fileurl: `${MEDIA_PREFIX}bark.mp3`,
              name: '강아지 짖는 소리',
              label: {
                ko: '강아지 짖는소리',
                en: "Doggi's Bark",
              },
            },
          ],
          pictures: [
            {
              id: 'vx80',
              fileurl: `${MEDIA_PREFIX}entrybot1.svg`,
              thumbUrl: `${MEDIA_PREFIX}entrybot1.svg`,
              name: '엔트리봇_걷기1',
              imageType: 'svg',
              dimension: {
                width: 144,
                height: 246,
              },
            },
            {
              id: '4t48',
              fileurl: `${MEDIA_PREFIX}entrybot2.svg`,
              thumbUrl: `${MEDIA_PREFIX}entrybot2.svg`,
              name: '엔트리봇_걷기2',
              imageType: 'svg',
              dimension: {
                width: 144,
                height: 246,
              },
            },
          ],
        },
        entity: {
          x: 0,
          y: 0,
          regX: 72,
          regY: 123,
          scaleX: 0.5128205128205128,
          scaleY: 0.5128205128205128,
          rotation: 0,
          direction: 90,
          width: 144,
          height: 246,
          visible: true,
        },
        lock: false,
        active: true,
      },
    ],
    expansionBlocks: [],
    aiUtilizeBlocks: [],
    speed: 60,
    messages: [],
    functions: [],
    tables: [],
  };
}

/** Media files that must be packed into the .ent archive. */
export const ENTRYBOT_MEDIA_FILES = [
  'entrybot1.svg',
  'entrybot2.svg',
  'bark.mp3',
] as const;
