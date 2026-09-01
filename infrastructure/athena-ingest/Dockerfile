# One-shot Fargate task image for the athenaOne FHIR bulk $export.
# Runs the same validated export code as the Lambda, but with no 15-min
# ceiling and using an ECS task role (no MFA / session expiry).
#
# Entry point runs the full 17-type export by default. Override the resource
# set by passing a comma-separated list as the container command argument, e.g.
#   ["Patient,Encounter,Condition"]
FROM public.ecr.aws/docker/library/python:3.12-slim

# boto3 is the only third-party dep; everything else is stdlib.
RUN pip install --no-cache-dir boto3==1.42.97

WORKDIR /app

# Only the runtime code is needed inside the image.
COPY athena_bulk_export_to_s3.py run_export_local.py /app/

# -u for unbuffered logs so CloudWatch shows progress live.
# Default arg "ALL" -> full 17-type export. Override via task command.
ENTRYPOINT ["python", "-u", "run_export_local.py"]
CMD ["ALL"]
