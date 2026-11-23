export type WeightUnitPref = 'kg' | 'lb';
export type DateFormatPref = 'dd/MM/yyyy' | 'yyyy-MM-dd';

export interface UserConfig {
  unidadPeso: WeightUnitPref;
  diasAvisoAlertas: number;
  sincronizacionAutomatica: boolean;
  formatoFecha: DateFormatPref;
  ranchoPredeterminadoId: string | null;
}

export const DEFAULT_USER_CONFIG: UserConfig = {
  unidadPeso: 'kg',
  diasAvisoAlertas: 7,
  sincronizacionAutomatica: true,
  formatoFecha: 'dd/MM/yyyy',
  ranchoPredeterminadoId: null
};

export interface LoginRequestDto {
  correo: string;
  contrasena: string;
}

export interface RegisterRequestDto {
  nombre: string;
  correo: string;
  contrasena: string;
}

export interface UpdateProfileRequestDto {
  nombre: string;
  correo: string;
}

export interface ChangePasswordRequestDto {
  contrasenaActual: string;
  nuevaContrasena: string;
}

export interface LoginRanchoDto {
  idRancho: string;
  nombre: string;
  rol: string;
}

export interface LoginResponseDto {
  token: string;
  expiraEn: string;
  idUsuario: string;
  nombre: string;
  ranchos: LoginRanchoDto[];
  correo?: string | null;
  fotoPerfilUrl?: string | null;
  configuracion?: UserConfig | null;
}

export interface SessionInfoResponseDto {
  expiraEn: string;
  idUsuario: string;
  nombre: string;
  ranchos: LoginRanchoDto[];
  correo?: string | null;
  fotoPerfilUrl?: string | null;
  configuracion?: UserConfig | null;
}

export interface CreateUsuarioRequestDto {
  nombre: string;
  correo: string;
  contrasena: string;
  estado: string;
  idUsuario?: string;
}

export interface UsuarioResponseDto {
  idUsuario: string;
  nombre: string;
  correo: string;
  estado: string;
  creadoEn: string;
  fotoPerfilUrl?: string | null;
  configuracion?: UserConfig | null;
}

export interface BackendRanchoPayload {
  idRancho?: string;
  nombre: string;
  ubicacionGeneral: string;
  estado: string;
}

export interface CreateUsuarioRanchoPayload {
  idUsuarioRancho?: string;
  idUsuario: string;
  idRancho: string;
  rol: string;
  estado: string;
}

export interface AuthSession {
  token: string;
  authMode?: 'bearer' | 'cookie';
  expiraEn: string;
  idUsuario: string;
  nombre: string;
  correo: string;
  ranchos: LoginRanchoDto[];
  fotoPerfilUrl?: string | null;
  configuracion?: UserConfig;
}

export interface RegisterUserInput {
  nombre: string;
  correo: string;
  contrasena: string;
  estado?: string;
}

export interface RanchInput {
  nombre: string;
  ubicacionGeneral: string;
  estado: string;
}
