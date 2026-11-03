// Reading the text in a payment screenshot, in the browser (tesseract.js). Nothing is sent anywhere
// for this. Browser only.

/** Text in an image, read on this device. Gives up after 45 seconds, including starting the reader. */
export async function readImageText(image: Blob): Promise<string> {
  const { createWorker } = await import("tesseract.js");
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("timeout")), 45_000);
  });
  const starting = createWorker("eng");
  try {
    const worker = await Promise.race([starting, timeout]);
    const { data } = await Promise.race([worker.recognize(image), timeout]);
    return data.text;
  } finally {
    clearTimeout(timer);
    starting.then((w) => w.terminate()).catch(() => {}); // even if it finished starting after the time limit
  }
}
