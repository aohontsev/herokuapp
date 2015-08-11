import os

from django.shortcuts import render, redirect
from django.http import HttpResponse


def index(request, template_name='landingpage/index.html'):
    return render(request, template_name)


def lib_js(request):
    views_dir = os.path.dirname(__file__)
    file_path = os.path.join('yandex', 'lib.js')
    abs_file_path = os.path.join(views_dir, file_path)
    data = open(abs_file_path, "rb").read()
    return HttpResponse(data, content_type="application/x-javascript")


def tr_url_js(request):
    views_dir = os.path.dirname(__file__)
    file_path = os.path.join('yandex', 'tr-url.js')
    abs_file_path = os.path.join(views_dir, file_path)
    data = open(abs_file_path, "rb").read()
    return HttpResponse(data, content_type="application/x-javascript")


def translate(request, *args, **kwargs):
    return redirect('https://translate.yandex.net/api/v1/tr/translate')
