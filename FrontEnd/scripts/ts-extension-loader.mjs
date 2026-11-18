export async function resolve(specifier, context, nextResolve) {
  if (specifier.startsWith('.') && !/\.(?:[cm]?[jt]s|json)$/.test(specifier)) {
    for (const extension of ['.ts', '.js']) {
      try {
        return await nextResolve(`${specifier}${extension}`, context);
      } catch (error) {
        if (error?.code !== 'ERR_MODULE_NOT_FOUND' && error?.code !== 'ERR_UNSUPPORTED_DIR_IMPORT') {
          throw error;
        }
      }
    }
  }
  return nextResolve(specifier, context);
}
