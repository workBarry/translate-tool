export interface TranslatorSessionInput {
  sourceLanguage: string;
  targetLanguage: string;

  onDownloadProgress?: (
    percentage: number,
  ) => void;
}

const translatorPromises =
  new Map<
    string,
    Promise<Translator>
  >();

function createSessionKey(
  sourceLanguage: string,
  targetLanguage: string,
): string {
  return `${sourceLanguage}->${targetLanguage}`;
}

export function getTranslatorSession(
  input: TranslatorSessionInput,
): Promise<Translator> {
  const key =
    createSessionKey(
      input.sourceLanguage,
      input.targetLanguage,
    );

  const cachedPromise =
    translatorPromises.get(key);

  if (cachedPromise) {
    return cachedPromise;
  }

  /*
   * 不要在這裡使用單次翻譯請求的
   * AbortSignal。
   *
   * 否則某一次翻譯取消，
   * 會把整個共用 session 的建立一起取消。
   */
  const sessionPromise =
    Translator.create({
      sourceLanguage:
        input.sourceLanguage,

      targetLanguage:
        input.targetLanguage,

      monitor(monitor) {
        monitor.addEventListener(
          'downloadprogress',
          (event) => {
            const percentage =
              Math.round(
                event.loaded * 100,
              );

            input
              .onDownloadProgress
              ?.(
                percentage,
              );
          },
        );
      },
    }).catch((error: unknown) => {
      /*
       * 建立失敗後必須刪除快取，
       * 否則之後永遠只會取得
       * rejected Promise。
       */
      translatorPromises.delete(
        key,
      );

      throw error;
    });

  translatorPromises.set(
    key,
    sessionPromise,
  );

  return sessionPromise;
}

export async function destroyAllTranslatorSessions():
  Promise<void> {
  const sessions =
    await Promise.allSettled(
      translatorPromises.values(),
    );

  for (const result of sessions) {
    if (
      result.status ===
      'fulfilled'
    ) {
      result.value.destroy();
    }
  }

  translatorPromises.clear();
}