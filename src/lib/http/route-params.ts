export type RouteParamsContext = {
  params?: Promise<Record<string, string | undefined>> | Record<string, string | undefined> | null;
};

export async function resolveRouteParams(
  context?: RouteParamsContext
): Promise<Record<string, string | undefined>> {
  const params = context?.params;
  return params ? await params : {};
}

export async function resolveRouteParamId(
  req: Request,
  context?: RouteParamsContext,
  trailingSegments = 0,
  paramName = 'id'
): Promise<string | undefined> {
  const resolved = await resolveRouteParams(context);
  const id = resolved[paramName];
  if (typeof id === 'string' && id.length > 0) {
    return id;
  }

  const segments = new URL(req.url).pathname.split('/').filter(Boolean);
  if (segments.at(-1) === 'providers' && trailingSegments === 0) {
    return undefined;
  }
  return segments.at(-(trailingSegments + 1)) ?? undefined;
}
