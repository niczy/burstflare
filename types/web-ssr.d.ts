declare module "*dist/server/ssr/index.js" {
  const handler: {
    fetch(request: Request): Promise<Response> | Response;
  };

  export default handler;
}
