import {
  WeighingRepository,
  HealthRepository,
  FeedingRepository,
  ReproductionRepository,
  LotRepository,
  MovementRepository,
  GenealogyRepository,
  AlertRepository,
  MediaRepository
} from '../lib/database/repositories';
import type {
  LocalWeighing,
  LocalHealthRecord,
  LocalFeedingRecord,
  LocalReproductionRecord,
  LocalLot,
  LocalMovement,
  LocalGenealogy,
  LocalAlert,
  LocalWeighingAnalysisJob,
  LocalMedia
} from '../lib/database/schema';

export const OfflineModulesService = {
  // 1. Pesajes Confirmados vs Trabajos de Análisis BoviScale (estrictamente separados)
  weighings: {
    listByCattle: (cattleId: string): Promise<LocalWeighing[]> =>
      WeighingRepository.getByCattleId(cattleId),
    listAll: (): Promise<LocalWeighing[]> => WeighingRepository.getAll(),
    recordConfirmed: (data: {
      cattleId: string;
      peso: number;
      fecha: string;
      observaciones?: string;
      ranchId?: string;
    }): Promise<LocalWeighing> => WeighingRepository.create(data, data),
    update: (id: string | number, changes: Partial<LocalWeighing>): Promise<LocalWeighing> =>
      WeighingRepository.update(id, changes, changes),
    remove: (id: string | number): Promise<void> => WeighingRepository.softDelete(id),
    confirmFromBoviScaleJob: (params: {
      idTrabajo: string;
      pesoConfirmadoKg: number;
      fecha?: string;
      observaciones?: string;
    }): Promise<LocalWeighing> => WeighingRepository.confirmFromAnalysisJob(params)
  },

  boviScaleJobs: {
    captureForAnalysis: (params: {
      fileOrBlob: Blob;
      idBovino: string;
      ranchId?: string;
      metadatosCaptura?: LocalWeighingAnalysisJob['metadatosCaptura'];
    }): Promise<{ media: LocalMedia; weighingJob?: LocalWeighingAnalysisJob }> =>
      MediaRepository.saveCapture({
        fileOrBlob: params.fileOrBlob,
        tipo: 'BoviScaleVision',
        entidadRelacionada: 'cattle',
        idEntidadRelacionada: params.idBovino,
        cattleId: params.idBovino,
        ranchId: params.ranchId,
        crearTrabajoPesaje: true,
        metadatosCaptura: params.metadatosCaptura
      }),
    listJobsByCattle: (idBovino: string): Promise<LocalWeighingAnalysisJob[]> =>
      MediaRepository.getWeighingJobsByCattle(idBovino),
    cancelJob: (idTrabajo: string): Promise<void> => MediaRepository.cancelAnalysisJob(idTrabajo)
  },

  // 2. Salud y Tratamientos
  health: {
    listByCattle: (cattleId: string): Promise<LocalHealthRecord[]> =>
      HealthRepository.getByCattleId(cattleId),
    listAll: (): Promise<LocalHealthRecord[]> => HealthRepository.getAll(),
    create: (data: {
      cattleId: string;
      tipo: string;
      descripcion: string;
      fecha: string;
      proximaAplicacion?: string;
      ranchId?: string;
    }): Promise<LocalHealthRecord> => HealthRepository.create(data, data),
    update: (id: string | number, changes: Partial<LocalHealthRecord>): Promise<LocalHealthRecord> =>
      HealthRepository.update(id, changes, changes),
    remove: (id: string | number): Promise<void> => HealthRepository.softDelete(id)
  },

  // 3. Alimentación y Raciones
  feeding: {
    listByLot: (lotId: string): Promise<LocalFeedingRecord[]> =>
      FeedingRepository.getByLotId(lotId),
    listAll: (): Promise<LocalFeedingRecord[]> => FeedingRepository.getAll(),
    create: (data: {
      lotId?: string;
      tipoAlimento: string;
      cantidadKg: number;
      fecha: string;
      ranchId?: string;
    }): Promise<LocalFeedingRecord> => FeedingRepository.create(data, data),
    update: (
      id: string | number,
      changes: Partial<LocalFeedingRecord>
    ): Promise<LocalFeedingRecord> => FeedingRepository.update(id, changes, changes),
    remove: (id: string | number): Promise<void> => FeedingRepository.softDelete(id)
  },

  // 4. Reproducción y Cría
  reproduction: {
    listByCattle: (cattleId: string): Promise<LocalReproductionRecord[]> =>
      ReproductionRepository.getByCattleId(cattleId),
    listAll: (): Promise<LocalReproductionRecord[]> => ReproductionRepository.getAll(),
    create: (data: {
      cattleId: string;
      evento: string;
      fecha: string;
      observaciones?: string;
      ranchId?: string;
    }): Promise<LocalReproductionRecord> => ReproductionRepository.create(data, data),
    update: (
      id: string | number,
      changes: Partial<LocalReproductionRecord>
    ): Promise<LocalReproductionRecord> => ReproductionRepository.update(id, changes, changes),
    remove: (id: string | number): Promise<void> => ReproductionRepository.softDelete(id)
  },

  // 5. Lotes y Potreros
  lots: {
    listAll: (): Promise<LocalLot[]> => LotRepository.getAll(),
    create: (data: {
      nombre: string;
      capacidad: number;
      ubicacion?: string;
      ranchId?: string;
    }): Promise<LocalLot> => LotRepository.create(data, data),
    update: (id: string | number, changes: Partial<LocalLot>): Promise<LocalLot> =>
      LotRepository.update(id, changes, changes),
    remove: (id: string | number): Promise<void> => LotRepository.softDelete(id)
  },

  // 6. Movimientos y Trazabilidad
  movements: {
    listByCattle: (cattleId: string): Promise<LocalMovement[]> =>
      MovementRepository.getByCattleId(cattleId),
    listAll: (): Promise<LocalMovement[]> => MovementRepository.getAll(),
    transferCattle: (input: {
      cattleId: string;
      origenLotId?: string;
      destinoLotId?: string;
      fecha: string;
      motivo: string;
      ranchId?: string;
    }): Promise<LocalMovement> => MovementRepository.registerCattleTransfer(input),
    remove: (id: string | number): Promise<void> => MovementRepository.softDelete(id)
  },

  // 7. Genealogía y Parentesco
  genealogy: {
    getByCattle: (cattleId: string): Promise<LocalGenealogy | undefined> =>
      GenealogyRepository.getByCattleId(cattleId),
    listAll: (): Promise<LocalGenealogy[]> => GenealogyRepository.getAll(),
    saveOrUpdate: async (data: {
      cattleId: string;
      padreId?: string;
      madreId?: string;
      ranchId?: string;
    }): Promise<LocalGenealogy> => {
      const existing = await GenealogyRepository.getByCattleId(data.cattleId);
      if (existing) {
        return await GenealogyRepository.update(existing.id, data, data);
      }
      return await GenealogyRepository.create(data, data);
    },
    remove: (id: string | number): Promise<void> => GenealogyRepository.softDelete(id)
  },

  // 8. Alertas y Recordatorios
  alerts: {
    listAll: (): Promise<LocalAlert[]> => AlertRepository.getAll(),
    listUnread: (): Promise<LocalAlert[]> => AlertRepository.getUnread(),
    create: (data: {
      tipo: string;
      prioridad: string;
      mensaje: string;
      leida: boolean;
      fecha: string;
      ranchId?: string;
    }): Promise<LocalAlert> => AlertRepository.create(data, data),
    markAsRead: (id: string | number): Promise<LocalAlert> => AlertRepository.markAsRead(id),
    remove: (id: string | number): Promise<void> => AlertRepository.softDelete(id)
  }
};
