import { fetchProjectData, fetchUserData, type ApiProject } from '@shared/api';

export async function fetchProjectDataWithApiKey(
  apiKey: string,
  cloudUrl: string,
): Promise<{ api_token: string; id: number; project: ApiProject }> {
  const userData = await fetchUserData(apiKey, cloudUrl);
  const projectId = userData.team?.id;

  if (!projectId) {
    throw new Error(
      'Could not determine project ID from API key. Please ensure your API key has access to a project in this cloud region.',
    );
  }

  const projectData = await fetchProjectData(apiKey, projectId, cloudUrl);
  return {
    api_token: projectData.api_token,
    id: projectId,
    project: projectData,
  };
}

export async function fetchProjectDataById(
  apiKey: string,
  projectId: number,
  cloudUrl: string,
): Promise<{ api_token: string; id: number; project: ApiProject }> {
  const projectData = await fetchProjectData(apiKey, projectId, cloudUrl);
  return {
    api_token: projectData.api_token,
    id: projectId,
    project: projectData,
  };
}
