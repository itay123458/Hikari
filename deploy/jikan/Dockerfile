FROM jikanme/jikan-rest@sha256:505f06101617c337db5b301701258de63a55f6593b0181cf2d84c92ff49cee9d
WORKDIR /app
USER root
RUN mkdir -p /var/cache/hikari-jikan && chown 10001:10001 /var/cache/hikari-jikan
COPY deploy/jikan/ /app/bridge/
ENV JIKAN_CACHE_DIR=/var/cache/hikari-jikan
USER 10001:10001
ENTRYPOINT ["php", "-d", "memory_limit=96M", "-S", "0.0.0.0:8080", "/app/bridge/router.php"]
CMD []
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD php -r 'exit(@file_get_contents("http://127.0.0.1:8080/healthz") === false ? 1 : 0);'
