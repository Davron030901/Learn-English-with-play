"""FastAPI dependencies: the container, a database session, services, limits, the caller."""

from __future__ import annotations

import ipaddress

from collections.abc import AsyncIterator
from typing import Annotated

from fastapi import Depends, Request
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.ext.asyncio import AsyncSession

from app.container import AppContainer
from app.errors import Unauthorized
from app.security.breached import PasswordScreen
from app.services.auth import AuthService, Principal
from app.services.passwords import PasswordService


def get_container(request: Request) -> AppContainer:
    container = getattr(request.app.state, "container", None)
    if not isinstance(container, AppContainer):
        raise RuntimeError("the application has not finished starting")
    return container


ContainerDep = Annotated[AppContainer, Depends(get_container)]


async def get_db_session(container: ContainerDep) -> AsyncIterator[AsyncSession]:
    async with container.sessionmaker() as session:
        yield session


DbSession = Annotated[AsyncSession, Depends(get_db_session)]


def _screen(container: AppContainer) -> PasswordScreen:
    return container.password_screen or PasswordScreen(container.metrics)


def get_auth_service(container: ContainerDep, session: DbSession) -> AuthService:
    return AuthService(
        session=session,
        hasher=container.hasher,
        tokens=container.tokens,
        clock=container.clock,
        policy=container.auth_policy,
        metrics=container.metrics,
        screen=_screen(container),
    )


AuthServiceDep = Annotated[AuthService, Depends(get_auth_service)]


def get_password_service(container: ContainerDep, session: DbSession) -> PasswordService:
    return PasswordService(
        session=session,
        hasher=container.hasher,
        screen=_screen(container),
        clock=container.clock,
        metrics=container.metrics,
    )


PasswordServiceDep = Annotated[PasswordService, Depends(get_password_service)]


def client_ip(request: Request) -> str:
    """The client address. Behind a proxy, uvicorn's ``--proxy-headers`` together with
    ``FORWARDED_ALLOW_IPS`` puts the real client here, and only from trusted proxies."""
    return request.client.host if request.client else "unknown"


#: IPv6 clients are limited per /64: one host usually holds a whole /64, and keying on the
#: full address would let it rotate through 2^64 buckets.
IPV6_RATE_LIMIT_PREFIX = 64


def rate_limit_ip_key(host: str) -> str:
    """The bucket for a client address: IPv4 as is, IPv4-mapped IPv6 as its IPv4, other IPv6
    as its /64 network. Anything unparseable is used verbatim."""
    try:
        addr = ipaddress.ip_address(host)
    except ValueError:
        return host
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:
            return str(addr.ipv4_mapped)
        return str(ipaddress.ip_network(f"{addr}/{IPV6_RATE_LIMIT_PREFIX}", strict=False))
    return str(addr)


def _ip_key(request: Request) -> str:
    return rate_limit_ip_key(client_ip(request))


async def limit_ip(request: Request, container: ContainerDep) -> None:
    await container.rate_limiter.enforce(container.limits.ip, _ip_key(request), fail_open=True)


async def limit_login_ip(request: Request, container: ContainerDep) -> None:
    await container.rate_limiter.enforce(
        container.limits.login_ip, _ip_key(request), fail_open=False
    )


async def limit_register_ip(request: Request, container: ContainerDep) -> None:
    await container.rate_limiter.enforce(
        container.limits.register_ip, _ip_key(request), fail_open=False
    )


async def limit_refresh_ip(request: Request, container: ContainerDep) -> None:
    # Fails open: a refresh token is 256 random bits, so a Redis outage gives an attacker
    # nothing to guess, while failing closed would sign every learner out within one
    # access-token lifetime (DECISIONS §2.7, revised).
    await container.rate_limiter.enforce(
        container.limits.refresh_ip, _ip_key(request), fail_open=True
    )


async def limit_password_reset_ip(request: Request, container: ContainerDep) -> None:
    await container.rate_limiter.enforce(
        container.limits.password_reset_ip, _ip_key(request), fail_open=False
    )


async def limit_client_events_ip(request: Request, container: ContainerDep) -> None:
    # fails open: an event lost while Redis is down costs nothing
    await container.rate_limiter.enforce(
        container.limits.client_events_ip, _ip_key(request), fail_open=True
    )


bearer_scheme = OAuth2PasswordBearer(tokenUrl="/v1/auth/login", auto_error=False)


async def current_principal(
    token: Annotated[str | None, Depends(bearer_scheme)],
    service: AuthServiceDep,
    container: ContainerDep,
) -> Principal:
    if not token:
        raise Unauthorized("Send an access token as 'Authorization: Bearer <token>'.")
    principal = await service.authenticate(token)
    await container.rate_limiter.enforce(
        container.limits.account, str(principal.learner_id), fail_open=True
    )
    return principal


CurrentPrincipal = Annotated[Principal, Depends(current_principal)]
