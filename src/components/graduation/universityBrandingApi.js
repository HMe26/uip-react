/**
 * Glue between <UniversityBrandingUploader /> and the Laravel API
 * (UniversitiesApiController: uploadBranding / deleteBranding / updateDean).
 *
 * `request(path, options)` is whatever your app uses to call the API with the logged-in token;
 * it must return the parsed JSON body ({ success, message, data }) and throw on a non-2xx.
 * If you have no such helper, `makeFetchRequest` below is a minimal one.
 *
 *   const request = makeFetchRequest({ baseUrl: import.meta.env.VITE_API_URL, getToken: () => token });
 *   <UniversityBrandingUploader value={urls} {...brandingHandlers(request, { onChange: setUrls })} />
 *
 * `urls` starts from GET /api/v1/universities/me -> data.university
 * (signature_url, stamp_url, dean_signature_url, dean_name_en/ar, dean_title_en/ar).
 */

export function makeFetchRequest({ baseUrl, getToken }) {
  return async (path, options = {}) => {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { Accept: 'application/json', Authorization: `Bearer ${getToken()}`, ...(options.headers || {}) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok || body.success === false) throw new Error(body.message || `HTTP ${res.status}`);
    return body;
  };
}

/** Props for <UniversityBrandingUploader />, backed by the API. */
export function brandingHandlers(request, { onChange } = {}) {
  const changed = (urls) => { if (onChange) onChange(urls); return urls; };
  return {
    onUpload: async (kind, blob) => {
      const form = new FormData();
      form.append('file', blob, `${kind}.png`);
      const body = await request(`/api/v1/universities/me/branding/${kind}`, { method: 'POST', body: form });
      changed(body.data);
      return { url: body.data[`${kind}_url`] };
    },
    onRemove: async (kind) => {
      const body = await request(`/api/v1/universities/me/branding/${kind}`, { method: 'DELETE' });
      changed(body.data);
    },
    onSaveDean: async (dean) => {
      const body = await request('/api/v1/universities/me/dean', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(dean),
      });
      changed(body.data);
    },
  };
}
