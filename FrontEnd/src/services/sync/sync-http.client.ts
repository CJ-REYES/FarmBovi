import {
  API_BASE_URL,
  ApiError,
  BACKEND_ROUTES,
  apiRequest,
  buildApiUrl
} from '../../lib/api';
import type { LocalOutboxQueue } from '../../lib/database/schema';
import type {
  BackendEndpointAvailability,
  SyncBatchPushRequestDto,
  SyncBatchPushResponseDto,
  SyncEndpointsConfig,
  SyncOperationRequestDto,
  SyncOperationResultDto,
  SyncPullRequestDto,
  SyncPullResponseDto
} from '../../types/sync-contracts';
import {
  validateSyncBatchPushResponse,
  validateSyncOperationResult,
  validateSyncPullResponse
} from './sync-response.validator';

export class SyncEndpointNotConfiguredError extends Error {
  readonly endpointType: 'push' | 'pull';

  constructor(endpointType: 'push' | 'pull') {
    super(
      `El endpoint de sincronización '${endpointType}' aún no existe o no está configurado en el backend.`
    );
    this.name = 'SyncEndpointNotConfiguredError';
    this.endpointType = endpointType;
  }
}

let configuredEndpoints: SyncEndpointsConfig = {
  pushEndpoint: (import.meta.env.VITE_SYNC_PUSH_URL as string | undefined)?.trim() || null,
  pullEndpoint: (import.meta.env.VITE_SYNC_PULL_URL as string | undefined)?.trim() || null
};

function mapHttpErrorToOperationResult(
  dto: SyncOperationRequestDto,
  err: unknown
): SyncOperationResultDto {
  if (err instanceof ApiError) {
    const body =
      err.data && typeof err.data === 'object'
        ? (err.data as Record<string, unknown>)
        : null;

    // 409 Conflict: versión base desactualizada en el servidor
    if (err.status === 409) {
      const serverState =
        body?.estadoServidor && typeof body.estadoServidor === 'object' && !Array.isArray(body.estadoServidor)
          ? (body.estadoServidor as Record<string, unknown>)
          : null;
      const serverVersion =
        typeof body?.versionServidor === 'number' || typeof body?.versionServidor === 'string'
          ? body.versionServidor
          : null;

      return {
        idOperacion: dto.idOperacion,
        entidad: dto.entidad,
        idEntidad: dto.idEntidad,
        resultado: 'CONFLICT',
        versionServidor: serverVersion,
        estadoServidor: serverState,
        mensaje: err.message,
        codigoHttp: 409
      };
    }

    // 400 / 422: error de validación de dominio o esquema
    if (err.status === 400 || err.status === 422) {
      const fieldErrors =
        body?.errors && typeof body.errors === 'object' && !Array.isArray(body.errors)
          ? (body.errors as Record<string, string[]>)
          : body?.erroresCampos &&
              typeof body.erroresCampos === 'object' &&
              !Array.isArray(body.erroresCampos)
            ? (body.erroresCampos as Record<string, string[]>)
            : undefined;

      return {
        idOperacion: dto.idOperacion,
        entidad: dto.entidad,
        idEntidad: dto.idEntidad,
        resultado: 'VALIDATION_ERROR',
        mensaje: err.message,
        erroresCampos: fieldErrors,
        codigoHttp: err.status
      };
    }

    // 401 / 403: sesión expirada o permisos insuficientes (sin exponer tokens)
    if (err.status === 401 || err.status === 403) {
      return {
        idOperacion: dto.idOperacion,
        entidad: dto.entidad,
        idEntidad: dto.idEntidad,
        resultado: 'TRANSIENT_ERROR',
        mensaje:
          err.status === 401
            ? 'Sesión no autenticada o expirada. Inicia sesión nuevamente para sincronizar.'
            : 'Permisos insuficientes para sincronizar en este rancho.',
        codigoHttp: err.status
      };
    }

    // 408, 429, 500, 502, 503, 504, status 0 (red/timeout) o respuestas malformadas
    return {
      idOperacion: dto.idOperacion,
      entidad: dto.entidad,
      idEntidad: dto.idEntidad,
      resultado: 'TRANSIENT_ERROR',
      mensaje: err.message,
      codigoHttp: err.status,
      retryAfterMs: err.retryAfterMs
    };
  }

  return {
    idOperacion: dto.idOperacion,
    entidad: dto.entidad,
    idEntidad: dto.idEntidad,
    resultado: 'TRANSIENT_ERROR',
    mensaje:
      err instanceof Error
        ? err.message
        : 'Error de infraestructura durante la comunicación de sincronización.'
  };
}

export const SyncHttpClient = {
  /**
   * Permite registrar rutas reales de sincronización una vez implementadas en ASP.NET Core.
   */
  configureEndpoints(config: Partial<SyncEndpointsConfig>): void {
    configuredEndpoints = {
      pushEndpoint:
        config.pushEndpoint !== undefined ? config.pushEndpoint : configuredEndpoints.pushEndpoint,
      pullEndpoint:
        config.pullEndpoint !== undefined ? config.pullEndpoint : configuredEndpoints.pullEndpoint
    };
  },

  getEndpointAvailability(): BackendEndpointAvailability {
    return {
      animalesCrudEndpoint: buildApiUrl(BACKEND_ROUTES.ANIMALES),
      animalesCrudDisponible: true,
      pushEndpoint: configuredEndpoints.pushEndpoint,
      pushDisponible: Boolean(configuredEndpoints.pushEndpoint),
      pullEndpoint: configuredEndpoints.pullEndpoint,
      pullDisponible: Boolean(configuredEndpoints.pullEndpoint)
    };
  },

  /**
   * Serializa una entrada persistente del Outbox al contrato estricto esperado por el servidor.
   */
  serializeOperationDto(
    op: LocalOutboxQueue,
    remoteId?: string | number | null
  ): SyncOperationRequestDto {
    return {
      idOperacion: op.idOperacion,
      entidad: op.entidad,
      idEntidad: op.idEntidad,
      remoteId: remoteId ?? null,
      tipoOperacion: op.tipoOperacion,
      versionBase: op.versionBase,
      payload: op.payload,
      fechaCreacionCliente: op.fechaCreacion
    };
  },

  /**
   * Envía una operación individual al endpoint de sincronización cuando exista.
   * Valida estrictamente el cuerpo de respuesta antes de aceptar confirmación.
   */
  async sendOperation(dto: SyncOperationRequestDto): Promise<SyncOperationResultDto> {
    if (!configuredEndpoints.pushEndpoint) {
      throw new SyncEndpointNotConfiguredError('push');
    }

    const headers: Record<string, string> = {
      'X-Idempotency-Key': dto.idOperacion
    };

    if (dto.versionBase !== null && dto.versionBase !== undefined) {
      headers['If-Match'] = String(dto.versionBase);
    }

    try {
      const response = await apiRequest<unknown>(configuredEndpoints.pushEndpoint, {
        method: 'POST',
        body: dto,
        headers
      });

      const validation = validateSyncOperationResult(response.data, dto.idOperacion);
      if (!validation.valid) {
        return {
          idOperacion: dto.idOperacion,
          entidad: dto.entidad,
          idEntidad: dto.idEntidad,
          resultado: 'TRANSIENT_ERROR',
          mensaje: `Respuesta del servidor no válida: ${validation.reason}`,
          codigoHttp: response.status
        };
      }

      return {
        ...validation.value,
        codigoHttp: response.status
      };
    } catch (err) {
      return mapHttpErrorToOperationResult(dto, err);
    }
  },

  /**
   * Envía un lote ordenado de operaciones pendientes al servidor cuando exista el endpoint.
   */
  async sendBatch(requestDto: SyncBatchPushRequestDto): Promise<SyncBatchPushResponseDto> {
    if (!configuredEndpoints.pushEndpoint) {
      throw new SyncEndpointNotConfiguredError('push');
    }

    if (requestDto.operaciones.length === 0) {
      return {
        resultados: [],
        fechaServidor: new Date().toISOString()
      };
    }

    const expectedIds = requestDto.operaciones.map((op) => op.idOperacion);
    const response = await apiRequest<unknown>(configuredEndpoints.pushEndpoint, {
      method: 'POST',
      body: requestDto,
      headers: {
        'X-Batch-Idempotency-Keys': expectedIds.join(',')
      }
    });

    const validation = validateSyncBatchPushResponse(response.data, expectedIds);
    if (!validation.valid) {
      throw new ApiError(
        `Respuesta de lote inválida del servidor: ${validation.reason}`,
        response.status,
        response.data
      );
    }

    return validation.value;
  },

  /**
   * Descarga cambios remotos paginados usando cursor opaco.
   */
  async fetchChanges<TData = Record<string, unknown>>(
    requestDto: SyncPullRequestDto
  ): Promise<SyncPullResponseDto<TData>> {
    if (!configuredEndpoints.pullEndpoint) {
      throw new SyncEndpointNotConfiguredError('pull');
    }

    const queryParams = new URLSearchParams();
    queryParams.set('entidad', requestDto.entidad);
    queryParams.set('limite', String(requestDto.limite));
    if (requestDto.cursorOpaco !== null && requestDto.cursorOpaco.trim().length > 0) {
      queryParams.set('cursorOpaco', requestDto.cursorOpaco);
    }
    if (requestDto.ranchId) {
      queryParams.set('ranchId', requestDto.ranchId);
    }

    const separator = configuredEndpoints.pullEndpoint.includes('?') ? '&' : '?';
    const urlWithQuery = `${configuredEndpoints.pullEndpoint}${separator}${queryParams.toString()}`;

    const response = await apiRequest<unknown>(urlWithQuery, {
      method: 'GET'
    });

    const validation = validateSyncPullResponse<TData>(response.data, requestDto.entidad);
    if (!validation.valid) {
      throw new ApiError(
        `Respuesta de descarga incremental inválida: ${validation.reason}`,
        response.status,
        response.data
      );
    }

    return validation.value;
  },

  getBaseUrl(): string {
    return API_BASE_URL;
  }
};
