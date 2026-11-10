/**
 * @file Typings for `@mixmark-io/domino`, which ships them under the old package name "domino".
 * Re-declared here for the fork.
 */
declare module '@mixmark-io/domino' {
  const domino: {
    createDocument(html?: string, force?: boolean): Document;
  };
  export default domino;
}
