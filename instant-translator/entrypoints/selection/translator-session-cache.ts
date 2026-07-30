export interface TranslatorSessionInput {
  sourceLanguage: string;
  targetLanguage: string;

  onDownloadProgress?: (
    percentage: number,
  ) => void;

  onPreparing?: () => void;
}

interface TranslatorSessionEntry {
  promise: Promise<Translator> | null;
  progress: number;
}

const sessionEntries =
  new Map<
    string,
    TranslatorSessionEntry
  >();

function createSessionKey(
  sourceLanguage: string,
  targetLanguage: string,
): string {
  return (
    `${sourceLanguage}` +
    `->${targetLanguage}`
  );
}

export function getTranslatorSession(
  input: TranslatorSessionInput,
): Promise<Translator> {
  if (!('Translator' in self)) {
    return Promise.reject(
      new Error(
        '目前瀏覽器不支援 Translator API',
      ),
    );
  }

  const key =
    createSessionKey(
      input.sourceLanguage,
      input.targetLanguage,
    );

  const existingEntry =
    sessionEntries.get(key);

  if (existingEntry?.promise) {
    /*
     * 同一個語言組合正在下載或已建立時，
     * 直接重用同一個 Promise。
     *
     * 不再次 Translator.create()。
     */
    if (
      existingEntry.progress > 0
    ) {
      input.onDownloadProgress?.(
        existingEntry.progress,
      );
    }

    if (
      existingEntry.progress >=
      100
    ) {
      input.onPreparing?.();
    }

    return existingEntry.promise;
  }

  const entry:
    TranslatorSessionEntry = {
      /*
       * 建立後立即覆蓋。
       */
      promise: null,

      progress: 0,
    };

  /*
   * 這裡不要傳入單次翻譯的 signal。
   *
   * 關閉卡片或重新選字時，
   * 模型下載仍會繼續。
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
            const loaded =
              Math.min(
                1,
                Math.max(
                  0,
                  event.loaded,
                ),
              );

            const percentage =
              Math.round(
                loaded * 100,
              );

            entry.progress =
              percentage;

            input
              .onDownloadProgress
              ?.(
                percentage,
              );

            /*
             * 100% 只代表檔案下載完成。
             * Chrome 可能仍在解壓與載入。
             */
            if (percentage >= 100) {
              input.onPreparing?.();
            }

            console.log(
              '[Instant Translator] Translator session 進度',
              {
                sourceLanguage:
                  input.sourceLanguage,

                targetLanguage:
                  input.targetLanguage,

                percentage,
              },
            );
          },
        );
      },
    })
      .then((translator) => {
        entry.progress = 100;

        input.onPreparing?.();

        console.log(
          '[Instant Translator] Translator session 已可使用',
          {
            sourceLanguage:
              input.sourceLanguage,

            targetLanguage:
              input.targetLanguage,
          },
        );

        return translator;
      })
      .catch((error: unknown) => {
        /*
         * 建立失敗後移除快取，
         * 下一次才允許重新嘗試。
         */
        if (sessionEntries.get(key) === entry) {
          sessionEntries.delete(key);
        }

        console.error(
          '[Instant Translator] Translator session 建立失敗',
          {
            sourceLanguage:
              input.sourceLanguage,

            targetLanguage:
              input.targetLanguage,

            error,
          },
        );

        throw error;
      });

  entry.promise =
    sessionPromise;

  sessionEntries.set(
    key,
    entry,
  );

  return sessionPromise;
}

/**
 * 移除指定語言組合的快取 Session。
 *
 * 只在 translate() 實際失敗後使用；一般取消、關閉卡片和切換語言
 * 都不應破壞可共用的 Translator Session。
 */
export async function invalidateTranslatorSession(
  sourceLanguage: string,
  targetLanguage: string,
): Promise<void> {
  const key = createSessionKey(sourceLanguage, targetLanguage);
  const entry = sessionEntries.get(key);

  sessionEntries.delete(key);

  if (!entry?.promise) {
    return;
  }

  const [result] = await Promise.allSettled([entry.promise]);

  if (result?.status === 'fulfilled') {
    try {
      result.value.destroy();
    } catch {
      // Session 可能已由 Chrome 失效或銷毀。
    }
  }
}

export async function destroyAllTranslatorSessions():
  Promise<void> {
  const results =
    await Promise.allSettled(
      Array.from(
        sessionEntries.values(),
        (entry) =>
          entry.promise ??
          Promise.resolve(null),
      ),
    );

  for (const result of results) {
    if (
      result.status ===
      'fulfilled'
    ) {
      result.value?.destroy();
    }
  }

  sessionEntries.clear();
}
