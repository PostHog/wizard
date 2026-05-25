import axios from 'axios';
import { analytics } from '../../../utils/analytics';
import { handleApiError } from '../../api';
import { WIZARD_USER_AGENT } from '../../constants';
import { HealthIssueListResponseSchema, type HealthIssue } from './types';

export async function fetchHealthIssues(
  accessToken: string,
  baseUrl: string,
  projectId: number,
): Promise<HealthIssue[]> {
  const endpoint = `/api/environments/${projectId}/health_issues/`;
  const url = `${baseUrl}${endpoint}?status=active&dismissed=false&limit=250`;
  try {
    const response = await axios.get(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'User-Agent': WIZARD_USER_AGENT,
      },
    });
    return HealthIssueListResponseSchema.parse(response.data).results;
  } catch (error) {
    const apiError = handleApiError(error, 'fetch health issues');
    analytics.captureException(apiError, { endpoint, baseUrl, projectId });
    throw apiError;
  }
}
